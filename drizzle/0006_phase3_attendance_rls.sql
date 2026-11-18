-- Phase 3: who may see and change staff, rosters, roll call, check-out and fingerprint punches (spec §5, §8.2, §8.3).
--
--   attendance viewers = owner, company manager, branch manager, front desk (branch); teachers for their rooms
--   attendance writers = branch manager, front desk (branch); teachers for their rooms
--   staff viewers      = owner, company manager, branch manager, accountant, HR (branch); everyone sees their own row
--   staff writers      = HR (spec §5 "Staff records: HR F")
--   roster             = branch manager (spec §8.3 "manager adjusts the roster on the Today screen")
--   punch imports      = branch manager (own branch) and HR (spec §5 Imports)
--
-- device_login is an auth table (like auth_session): read by the sign-in code before anyone is
-- signed in, so it has no row-level security.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_attendance_viewer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['owner', 'company_manager', 'branch_manager', 'front_desk']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_attendance_writer(p_branch uuid, p_room uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['branch_manager', 'front_desk']::app_role[])
      OR (p_room IS NOT NULL AND p_room = ANY (app_teacher_room_ids()))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_staff_viewer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['owner', 'company_manager', 'branch_manager', 'accountant', 'hr']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_punch_writer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['branch_manager', 'hr']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_own_staff_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(id), '{}') FROM staff WHERE user_id = app_current_user_id()
$$;
--> statement-breakpoint

-- Rows that hang off a staff member or a child take their branch from it.
CREATE OR REPLACE FUNCTION app_attendance_branch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room uuid;
  v_branch uuid;
BEGIN
  IF TG_TABLE_NAME IN ('room_roster', 'staff_attendance_day') THEN
    SELECT branch_id INTO NEW.branch_id FROM staff WHERE id = NEW.staff_id;
    IF NEW.branch_id IS NULL THEN RAISE EXCEPTION 'staff not found' USING ERRCODE = '23503'; END IF;
    -- Nested IF: PL/pgSQL would resolve NEW.room_id even after a false first test, and
    -- staff_attendance_day has no room_id.
    IF TG_TABLE_NAME = 'room_roster' THEN
      IF NEW.room_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM room WHERE id = NEW.room_id AND branch_id = NEW.branch_id) THEN
          RAISE EXCEPTION 'room belongs to another branch' USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'pickup_refusal' THEN
    SELECT branch_id INTO NEW.branch_id FROM student WHERE id = NEW.student_id;
    IF NEW.branch_id IS NULL THEN RAISE EXCEPTION 'child not found' USING ERRCODE = '23503'; END IF;
  ELSIF TG_TABLE_NAME = 'staff_punch' THEN
    IF NEW.staff_id IS NOT NULL THEN
      SELECT branch_id INTO v_branch FROM staff WHERE id = NEW.staff_id;
      IF v_branch IS DISTINCT FROM NEW.branch_id THEN
        RAISE EXCEPTION 'staff belongs to another branch' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'staff' THEN
    IF NEW.default_room_id IS NOT NULL THEN
      SELECT branch_id INTO v_branch FROM room WHERE id = NEW.default_room_id;
      IF v_branch IS DISTINCT FROM NEW.branch_id THEN
        RAISE EXCEPTION 'room belongs to another branch' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'student_attendance' THEN
    -- Roll call is taken for children with an active enrollment; the row records their room that day.
    IF TG_OP = 'INSERT' THEN
      SELECT e.branch_id, e.room_id INTO v_branch, v_room
      FROM enrollment e WHERE e.student_id = NEW.student_id AND e.status = 'active';
      IF v_branch IS NULL THEN RAISE EXCEPTION 'not_enrolled' USING ERRCODE = '23514'; END IF;
      NEW.branch_id := v_branch;
      NEW.room_id := v_room;
    ELSE
      NEW.branch_id := OLD.branch_id;
      NEW.room_id := OLD.room_id;
      NEW.student_id := OLD.student_id;
      NEW.date := OLD.date;
    END IF;
    -- Check-out only to an adult on the child's approved pickup list (spec §8.2).
    IF NEW.collected_by_guardian_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM student_guardian sg
        WHERE sg.student_id = NEW.student_id AND sg.guardian_id = NEW.collected_by_guardian_id AND sg.can_pick_up
      ) THEN
        RAISE EXCEPTION 'pickup_not_approved' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.check_out_at IS NOT NULL THEN
      IF NEW.status <> 'present' THEN RAISE EXCEPTION 'not_checked_in' USING ERRCODE = '23514'; END IF;
      IF NEW.collected_by_guardian_id IS NULL THEN RAISE EXCEPTION 'pickup_not_approved' USING ERRCODE = '23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER staff_branch_check BEFORE INSERT OR UPDATE OF branch_id, default_room_id ON staff
  FOR EACH ROW EXECUTE FUNCTION app_attendance_branch();
--> statement-breakpoint
CREATE TRIGGER room_roster_branch BEFORE INSERT OR UPDATE ON room_roster
  FOR EACH ROW EXECUTE FUNCTION app_attendance_branch();
--> statement-breakpoint
CREATE TRIGGER staff_attendance_day_branch BEFORE INSERT OR UPDATE ON staff_attendance_day
  FOR EACH ROW EXECUTE FUNCTION app_attendance_branch();
--> statement-breakpoint
CREATE TRIGGER pickup_refusal_branch BEFORE INSERT OR UPDATE OF student_id, branch_id ON pickup_refusal
  FOR EACH ROW EXECUTE FUNCTION app_attendance_branch();
--> statement-breakpoint
CREATE TRIGGER staff_punch_branch BEFORE INSERT OR UPDATE OF staff_id, branch_id ON staff_punch
  FOR EACH ROW EXECUTE FUNCTION app_attendance_branch();
--> statement-breakpoint
CREATE TRIGGER student_attendance_branch BEFORE INSERT OR UPDATE ON student_attendance
  FOR EACH ROW EXECUTE FUNCTION app_attendance_branch();
--> statement-breakpoint

-- The branch manager (or HR) links a fingerprint number to a person and attaches that number's punches.
CREATE OR REPLACE FUNCTION app_set_staff_device_no(p_staff uuid, p_no text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
  v_count integer;
BEGIN
  SELECT branch_id INTO v_branch FROM staff WHERE id = p_staff;
  IF v_branch IS NULL OR NOT app_punch_writer(v_branch) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  p_no := nullif(btrim(p_no), '');
  UPDATE staff SET device_employee_no = p_no WHERE id = p_staff;
  UPDATE staff_punch SET staff_id = NULL WHERE staff_id = p_staff AND device_employee_no IS DISTINCT FROM p_no;
  UPDATE staff_punch SET staff_id = p_staff WHERE branch_id = v_branch AND device_employee_no = p_no;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint

-- Spec §8.3: ratio for one room now. Carers count once confirmed (the manager's tap, else a fingerprint
-- day of present/late). A new snapshot is written only when the figures changed since the room's last one today.
CREATE OR REPLACE FUNCTION app_take_ratio_snapshot(p_room uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
  v_per integer;
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_children integer;
  v_carers integer;
  v_required integer;
  v_last ratio_snapshot%ROWTYPE;
BEGIN
  SELECT r.branch_id, b.children_per_staff INTO v_branch, v_per
  FROM room r JOIN age_band b ON b.id = r.age_band_id WHERE r.id = p_room;
  IF v_branch IS NULL THEN RETURN; END IF;
  IF NOT (app_attendance_writer(v_branch, p_room) OR app_punch_writer(v_branch)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_children FROM student_attendance
  WHERE room_id = p_room AND date = v_today AND status = 'present' AND check_out_at IS NULL;

  SELECT count(*) INTO v_carers
  FROM staff s
  LEFT JOIN room_roster rr ON rr.staff_id = s.id AND rr.date = v_today
  LEFT JOIN staff_attendance_day d ON d.staff_id = s.id AND d.date = v_today
  WHERE s.branch_id = v_branch AND s.status = 'active' AND s.is_qualified_carer
    AND CASE WHEN rr.staff_id IS NOT NULL THEN rr.room_id ELSE s.default_room_id END = p_room
    AND coalesce(rr.marked_present, d.status IN ('present', 'late'), false);

  v_required := CASE WHEN v_children = 0 THEN 0 ELSE ceil(v_children::numeric / greatest(v_per, 1))::integer END;

  SELECT * INTO v_last FROM ratio_snapshot
  WHERE room_id = p_room AND taken_at >= (v_today::timestamp AT TIME ZONE 'Africa/Cairo')
  ORDER BY taken_at DESC LIMIT 1;
  IF FOUND AND v_last.children_present = v_children AND v_last.carers_present = v_carers THEN RETURN; END IF;

  INSERT INTO ratio_snapshot (branch_id, room_id, children_present, carers_present, required_carers, is_breach, reason, created_by)
  VALUES (v_branch, p_room, v_children, v_carers, v_required, v_carers < v_required, p_reason, app_current_user_id());
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit: business tables are audited. Punches, derived days and ratio snapshots are machine
-- records (their import batch is audited instead), so they are not copied into the audit log.
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
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_before := audit_redact(TG_TABLE_NAME, to_jsonb(OLD)); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_after := audit_redact(TG_TABLE_NAME, to_jsonb(NEW)); END IF;

  IF TG_OP = 'UPDATE'
     AND (v_before - 'updated_at' - 'updated_by') = (v_after - 'updated_at' - 'updated_by') THEN
    RETURN NULL;
  END IF;

  v_row := coalesce(v_after, v_before);
  v_row_id := coalesce(
    v_row ->> 'id',
    v_row ->> 'student_id',
    CASE WHEN TG_TABLE_NAME = 'user_room' THEN concat_ws('/', v_row ->> 'user_id', v_row ->> 'room_id') END,
    CASE WHEN TG_TABLE_NAME = 'room_roster' THEN concat_ws('/', v_row ->> 'staff_id', v_row ->> 'date') END,
    CASE WHEN TG_TABLE_NAME = 'import_mapping' THEN concat_ws('/', v_row ->> 'branch_id', v_row ->> 'kind') END,
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
  FOREACH t IN ARRAY ARRAY['staff', 'room_roster', 'student_attendance', 'pickup_refusal', 'import_mapping'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()',
      t || '_audit', t
    );
  END LOOP;
  FOREACH t IN ARRAY ARRAY['staff', 'room_roster', 'student_attendance', 'pickup_refusal', 'import_mapping',
                           'staff_punch', 'staff_attendance_day'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_columns()',
      t || '_set_updated', t
    );
  END LOOP;
  FOREACH t IN ARRAY ARRAY['staff', 'room_roster', 'student_attendance', 'pickup_refusal', 'import_mapping',
                           'staff_punch', 'staff_attendance_day', 'ratio_snapshot'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON staff, room_roster, student_attendance, pickup_refusal, import_mapping,
  staff_punch, staff_attendance_day TO yanmu_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON ratio_snapshot TO yanmu_app;
--> statement-breakpoint
GRANT DELETE ON room_roster, staff_punch, staff_attendance_day TO yanmu_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON device_login TO yanmu_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_set_staff_device_no(uuid, text), app_take_ratio_snapshot(uuid, text) TO yanmu_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

CREATE POLICY staff_read ON staff FOR SELECT TO yanmu_app
  USING (app_staff_viewer(branch_id) OR user_id = app_current_user_id()
         OR app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]));
--> statement-breakpoint
CREATE POLICY staff_insert ON staff FOR INSERT TO yanmu_app
  WITH CHECK (app_has_role_in(branch_id, ARRAY['hr']::app_role[]));
--> statement-breakpoint
CREATE POLICY staff_update ON staff FOR UPDATE TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['hr']::app_role[]))
  WITH CHECK (app_has_role_in(branch_id, ARRAY['hr']::app_role[]));
--> statement-breakpoint

CREATE POLICY room_roster_read ON room_roster FOR SELECT TO yanmu_app
  USING (app_staff_viewer(branch_id) OR staff_id = ANY (app_own_staff_ids()));
--> statement-breakpoint
CREATE POLICY room_roster_insert ON room_roster FOR INSERT TO yanmu_app
  WITH CHECK (app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]));
--> statement-breakpoint
CREATE POLICY room_roster_update ON room_roster FOR UPDATE TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]))
  WITH CHECK (app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]));
--> statement-breakpoint
CREATE POLICY room_roster_delete ON room_roster FOR DELETE TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]));
--> statement-breakpoint

CREATE POLICY student_attendance_read ON student_attendance FOR SELECT TO yanmu_app
  USING (app_attendance_viewer(branch_id) OR room_id = ANY (app_teacher_room_ids()));
--> statement-breakpoint
CREATE POLICY student_attendance_insert ON student_attendance FOR INSERT TO yanmu_app
  WITH CHECK (app_attendance_writer(branch_id, room_id));
--> statement-breakpoint
CREATE POLICY student_attendance_update ON student_attendance FOR UPDATE TO yanmu_app
  USING (app_attendance_writer(branch_id, room_id)) WITH CHECK (app_attendance_writer(branch_id, room_id));
--> statement-breakpoint

CREATE POLICY pickup_refusal_read ON pickup_refusal FOR SELECT TO yanmu_app
  USING (app_attendance_viewer(branch_id) OR created_by = app_current_user_id());
--> statement-breakpoint
CREATE POLICY pickup_refusal_insert ON pickup_refusal FOR INSERT TO yanmu_app
  WITH CHECK (app_has_role_in(branch_id, ARRAY['branch_manager', 'front_desk']::app_role[])
              OR app_teacher_sees_student(student_id));
--> statement-breakpoint
CREATE POLICY pickup_refusal_update ON pickup_refusal FOR UPDATE TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]))
  WITH CHECK (app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]));
--> statement-breakpoint

CREATE POLICY staff_punch_read ON staff_punch FOR SELECT TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager', 'hr']::app_role[]));
--> statement-breakpoint
CREATE POLICY staff_punch_insert ON staff_punch FOR INSERT TO yanmu_app WITH CHECK (app_punch_writer(branch_id));
--> statement-breakpoint
CREATE POLICY staff_punch_update ON staff_punch FOR UPDATE TO yanmu_app
  USING (app_punch_writer(branch_id)) WITH CHECK (app_punch_writer(branch_id));
--> statement-breakpoint
CREATE POLICY staff_punch_delete ON staff_punch FOR DELETE TO yanmu_app USING (app_punch_writer(branch_id));
--> statement-breakpoint

CREATE POLICY staff_attendance_day_read ON staff_attendance_day FOR SELECT TO yanmu_app
  USING (app_staff_viewer(branch_id) OR staff_id = ANY (app_own_staff_ids()));
--> statement-breakpoint
CREATE POLICY staff_attendance_day_insert ON staff_attendance_day FOR INSERT TO yanmu_app WITH CHECK (app_punch_writer(branch_id));
--> statement-breakpoint
CREATE POLICY staff_attendance_day_update ON staff_attendance_day FOR UPDATE TO yanmu_app
  USING (app_punch_writer(branch_id)) WITH CHECK (app_punch_writer(branch_id));
--> statement-breakpoint
CREATE POLICY staff_attendance_day_delete ON staff_attendance_day FOR DELETE TO yanmu_app USING (app_punch_writer(branch_id));
--> statement-breakpoint

CREATE POLICY import_mapping_read ON import_mapping FOR SELECT TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['company_manager', 'branch_manager', 'hr']::app_role[]));
--> statement-breakpoint
CREATE POLICY import_mapping_insert ON import_mapping FOR INSERT TO yanmu_app
  WITH CHECK (app_has_role_in(branch_id, ARRAY['company_manager', 'branch_manager', 'hr']::app_role[]));
--> statement-breakpoint
CREATE POLICY import_mapping_update ON import_mapping FOR UPDATE TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['company_manager', 'branch_manager', 'hr']::app_role[]))
  WITH CHECK (app_has_role_in(branch_id, ARRAY['company_manager', 'branch_manager', 'hr']::app_role[]));
--> statement-breakpoint

CREATE POLICY ratio_snapshot_read ON ratio_snapshot FOR SELECT TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[]));
--> statement-breakpoint
CREATE POLICY ratio_snapshot_insert ON ratio_snapshot FOR INSERT TO yanmu_app
  WITH CHECK (app_attendance_writer(branch_id, room_id) OR app_punch_writer(branch_id));
--> statement-breakpoint

-- Staff fingerprint files use the same import batches as children (spec §8.11), with their own importers.
DROP POLICY import_batch_read ON import_batch;
--> statement-breakpoint
DROP POLICY import_batch_insert ON import_batch;
--> statement-breakpoint
DROP POLICY import_batch_update ON import_batch;
--> statement-breakpoint
CREATE POLICY import_batch_read ON import_batch FOR SELECT TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[])
         OR (kind = 'staff_punches' AND app_punch_writer(branch_id)));
--> statement-breakpoint
CREATE POLICY import_batch_insert ON import_batch FOR INSERT TO yanmu_app
  WITH CHECK ((kind = 'children' AND app_child_importer(branch_id))
              OR (kind = 'staff_punches' AND app_punch_writer(branch_id)));
--> statement-breakpoint
CREATE POLICY import_batch_update ON import_batch FOR UPDATE TO yanmu_app
  USING ((kind = 'children' AND app_child_importer(branch_id)) OR (kind = 'staff_punches' AND app_punch_writer(branch_id)))
  WITH CHECK ((kind = 'children' AND app_child_importer(branch_id)) OR (kind = 'staff_punches' AND app_punch_writer(branch_id)));
