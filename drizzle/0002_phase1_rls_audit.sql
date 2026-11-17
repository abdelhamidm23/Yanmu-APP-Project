-- Phase 1: database role for the app, branch isolation (row-level security),
-- automatic audit trail, and calendar helpers. Spec §13.1, §13.2, CLAUDE.md rules 3, 4, 7.
--
-- The app connects as `yanmu_app`, which owns nothing and is subject to every policy.
-- Migrations and seed scripts run as the database owner.
-- The only per-request context the app sets is `app.user_id` (SET LOCAL via set_config);
-- which branches a person may see is worked out here, from user_branch_role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yanmu_app') THEN
    CREATE ROLE yanmu_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO yanmu_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Who is acting, and what may they see
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint

-- Roles of the acting user that are still in force (end date not reached, Cairo time).
CREATE OR REPLACE FUNCTION app_active_roles() RETURNS TABLE (branch_id uuid, role app_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.branch_id, r.role
  FROM user_branch_role r
  JOIN app_user u ON u.id = r.user_id
  WHERE r.user_id = app_current_user_id()
    AND (u.end_date IS NULL OR u.end_date > (now() AT TIME ZONE 'Africa/Cairo')::date)
$$;
--> statement-breakpoint

-- Owner or company manager across the organization.
CREATE OR REPLACE FUNCTION app_is_org_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_active_roles() r
    WHERE r.branch_id IS NULL AND r.role IN ('owner', 'company_manager')
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM app_active_roles() r WHERE r.branch_id IS NULL AND r.role = 'owner')
$$;
--> statement-breakpoint

-- Branches the acting user holds a role in. An organization-wide role (branch_id null) sees all branches.
CREATE OR REPLACE FUNCTION app_visible_branch_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM app_active_roles() r WHERE r.branch_id IS NULL)
      THEN (SELECT coalesce(array_agg(b.id), '{}') FROM branch b)
    ELSE (SELECT coalesce(array_agg(DISTINCT r.branch_id), '{}') FROM app_active_roles() r)
  END
$$;
--> statement-breakpoint

-- Does the acting user hold one of these roles in this branch (or organization-wide)?
CREATE OR REPLACE FUNCTION app_has_role_in(p_branch uuid, p_roles app_role[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_active_roles() r
    WHERE r.role = ANY (p_roles) AND (r.branch_id IS NULL OR r.branch_id = p_branch)
  )
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- updated_at / updated_by on every tracked table
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_columns() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := app_current_user_id();
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit trail (rule 7): who, when, before, after. Append-only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_row_id text;
  v_branch uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_before := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_after := to_jsonb(NEW); END IF;

  -- Ignore updates that change nothing but the bookkeeping columns.
  IF TG_OP = 'UPDATE'
     AND (v_before - 'updated_at' - 'updated_by') = (v_after - 'updated_at' - 'updated_by') THEN
    RETURN NULL;
  END IF;

  v_row := coalesce(v_after, v_before);
  v_row_id := coalesce(
    v_row ->> 'id',
    concat_ws('/', v_row ->> 'branch_id', v_row ->> 'date')
  );
  v_branch := CASE
    WHEN TG_TABLE_NAME = 'branch' THEN (v_row ->> 'id')::uuid
    ELSE nullif(v_row ->> 'branch_id', '')::uuid
  END;

  INSERT INTO audit_event (actor_user_id, branch_id, table_name, row_id, action, before, after, reason)
  VALUES (
    app_current_user_id(),
    v_branch,
    TG_TABLE_NAME,
    v_row_id,
    lower(TG_OP),
    v_before,
    v_after,
    nullif(current_setting('app.audit_reason', true), '')
  );
  RETURN NULL;
END
$$;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organization', 'branch', 'age_band', 'room', 'academic_year', 'term',
    'calendar_day', 'setting', 'user_branch_role', 'app_user'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()',
      t || '_audit', t
    );
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'organization', 'branch', 'age_band', 'room', 'academic_year', 'term', 'calendar_day', 'setting'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_columns()',
      t || '_set_updated', t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Working days (spec W1): weekly pattern from settings + per-branch exceptions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_working_day(p_branch uuid, p_date date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT c.is_working_day FROM calendar_day c WHERE c.branch_id = p_branch AND c.date = p_date),
    (
      SELECT (s.value ? lower(to_char(p_date, 'Dy')))
      FROM setting s
      JOIN branch b ON b.org_id = s.org_id AND b.id = p_branch
      WHERE s.key = 'calendar.working_days' AND (s.branch_id = p_branch OR s.branch_id IS NULL)
      ORDER BY s.branch_id NULLS LAST
      LIMIT 1
    ),
    extract(isodow FROM p_date) IN (7, 1, 2, 3, 4) -- Sunday to Thursday
  )
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Privileges. Auth tables and app_user are used by the sign-in library before anyone
-- is signed in, so they have no row policies; screens that list users check roles on the server.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON app_user, auth_session, auth_account, auth_verification, auth_two_factor TO yanmu_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON organization, branch, age_band, room, academic_year, term, setting TO yanmu_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_day, user_branch_role TO yanmu_app;
--> statement-breakpoint
GRANT DELETE ON term TO yanmu_app;
--> statement-breakpoint
GRANT SELECT ON audit_event TO yanmu_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION is_working_day(uuid, date) TO yanmu_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row-level security (rules 3 and 4)
-- ---------------------------------------------------------------------------

ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_read ON organization FOR SELECT TO yanmu_app USING (app_current_user_id() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY organization_update ON organization FOR UPDATE TO yanmu_app USING (app_is_org_admin()) WITH CHECK (app_is_org_admin());
--> statement-breakpoint

ALTER TABLE branch ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY branch_read ON branch FOR SELECT TO yanmu_app USING (id = ANY (app_visible_branch_ids()));
--> statement-breakpoint
CREATE POLICY branch_insert ON branch FOR INSERT TO yanmu_app WITH CHECK (app_is_org_admin());
--> statement-breakpoint
CREATE POLICY branch_update ON branch FOR UPDATE TO yanmu_app USING (app_is_org_admin()) WITH CHECK (app_is_org_admin());
--> statement-breakpoint

ALTER TABLE age_band ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY age_band_read ON age_band FOR SELECT TO yanmu_app USING (app_current_user_id() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY age_band_insert ON age_band FOR INSERT TO yanmu_app WITH CHECK (app_is_org_admin());
--> statement-breakpoint
CREATE POLICY age_band_update ON age_band FOR UPDATE TO yanmu_app USING (app_is_org_admin()) WITH CHECK (app_is_org_admin());
--> statement-breakpoint

ALTER TABLE room ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY room_read ON room FOR SELECT TO yanmu_app USING (branch_id = ANY (app_visible_branch_ids()));
--> statement-breakpoint
CREATE POLICY room_insert ON room FOR INSERT TO yanmu_app WITH CHECK (app_is_org_admin());
--> statement-breakpoint
CREATE POLICY room_update ON room FOR UPDATE TO yanmu_app USING (app_is_org_admin()) WITH CHECK (app_is_org_admin());
--> statement-breakpoint

ALTER TABLE academic_year ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY academic_year_read ON academic_year FOR SELECT TO yanmu_app USING (app_current_user_id() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY academic_year_insert ON academic_year FOR INSERT TO yanmu_app WITH CHECK (app_is_org_admin());
--> statement-breakpoint
CREATE POLICY academic_year_update ON academic_year FOR UPDATE TO yanmu_app USING (app_is_org_admin()) WITH CHECK (app_is_org_admin());
--> statement-breakpoint

ALTER TABLE term ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY term_read ON term FOR SELECT TO yanmu_app USING (app_current_user_id() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY term_insert ON term FOR INSERT TO yanmu_app WITH CHECK (app_is_org_admin());
--> statement-breakpoint
CREATE POLICY term_update ON term FOR UPDATE TO yanmu_app USING (app_is_org_admin()) WITH CHECK (app_is_org_admin());
--> statement-breakpoint
CREATE POLICY term_delete ON term FOR DELETE TO yanmu_app USING (app_is_org_admin());
--> statement-breakpoint

-- Holidays: company manager / owner everywhere, branch manager in their own branch (spec W1).
ALTER TABLE calendar_day ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendar_day_read ON calendar_day FOR SELECT TO yanmu_app USING (branch_id = ANY (app_visible_branch_ids()));
--> statement-breakpoint
CREATE POLICY calendar_day_insert ON calendar_day FOR INSERT TO yanmu_app
  WITH CHECK (app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[]));
--> statement-breakpoint
CREATE POLICY calendar_day_update ON calendar_day FOR UPDATE TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[]))
  WITH CHECK (app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[]));
--> statement-breakpoint
CREATE POLICY calendar_day_delete ON calendar_day FOR DELETE TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[]));
--> statement-breakpoint

ALTER TABLE setting ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY setting_read ON setting FOR SELECT TO yanmu_app
  USING (app_current_user_id() IS NOT NULL AND (branch_id IS NULL OR branch_id = ANY (app_visible_branch_ids())));
--> statement-breakpoint
CREATE POLICY setting_insert ON setting FOR INSERT TO yanmu_app WITH CHECK (app_is_org_admin());
--> statement-breakpoint
CREATE POLICY setting_update ON setting FOR UPDATE TO yanmu_app USING (app_is_org_admin()) WITH CHECK (app_is_org_admin());
--> statement-breakpoint

-- Roles: you see your own, admins see all, branch staff see who works in their branches.
-- Only the owner can hand out the owner role; nobody edits their own roles.
ALTER TABLE user_branch_role ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_branch_role_read ON user_branch_role FOR SELECT TO yanmu_app
  USING (user_id = app_current_user_id() OR app_is_org_admin() OR branch_id = ANY (app_visible_branch_ids()));
--> statement-breakpoint
CREATE POLICY user_branch_role_insert ON user_branch_role FOR INSERT TO yanmu_app
  WITH CHECK (app_is_org_admin() AND user_id <> app_current_user_id() AND (role <> 'owner' OR app_is_owner()));
--> statement-breakpoint
CREATE POLICY user_branch_role_update ON user_branch_role FOR UPDATE TO yanmu_app
  USING (false);
--> statement-breakpoint
CREATE POLICY user_branch_role_delete ON user_branch_role FOR DELETE TO yanmu_app
  USING (app_is_org_admin() AND user_id <> app_current_user_id() AND (role <> 'owner' OR app_is_owner()));
--> statement-breakpoint

-- Audit log (spec §5): owner and company manager. The accountant gets finance rows in Phase 4.
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_event_read ON audit_event FOR SELECT TO yanmu_app
  USING (app_is_org_admin());
