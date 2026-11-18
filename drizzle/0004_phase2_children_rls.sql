-- Phase 2: who may see and change children's records (spec §5), the licence cap (spec D11, §7.3),
-- transfers and over-capacity approvals, and audit for the new tables.
--
-- Who sees what (spec §5):
--   viewers  = owner, company manager, branch manager, front desk, accountant (in that branch)
--   writers  = branch manager, front desk (own branch)
--   importer = company manager (spreadsheet imports and their rollback)
--   teacher  = only children with an active enrollment in a room they look after (user_room)
--   medical  = branch manager (own) and the child's teachers; owner / company manager by break-glass only

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_child_viewer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['owner', 'company_manager', 'branch_manager', 'front_desk', 'accountant']::app_role[])
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_child_writer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['branch_manager', 'front_desk']::app_role[])
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_child_importer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['company_manager']::app_role[])
$$;
--> statement-breakpoint

-- Rooms the acting user looks after as a teacher (role still in force).
CREATE OR REPLACE FUNCTION app_teacher_room_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT ur.room_id), '{}')
  FROM user_room ur
  JOIN app_active_roles() r ON r.role = 'teacher' AND (r.branch_id IS NULL OR r.branch_id = ur.branch_id)
  WHERE ur.user_id = app_current_user_id()
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_teacher_sees_student(p_student uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM enrollment e
    WHERE e.student_id = p_student AND e.status = 'active' AND e.room_id = ANY (app_teacher_room_ids())
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_teacher_sees_family(p_family uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM student s
    JOIN enrollment e ON e.student_id = s.id AND e.status = 'active'
    WHERE s.family_id = p_family AND e.room_id = ANY (app_teacher_room_ids())
  )
$$;
--> statement-breakpoint

-- The branch a child belongs to now (used so a new branch sees the child's earlier enrollments).
CREATE OR REPLACE FUNCTION app_student_branch(p_student uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT branch_id FROM student WHERE id = p_student
$$;
--> statement-breakpoint

-- Child's age in whole months on a date.
CREATE OR REPLACE FUNCTION app_age_months(p_dob date, p_on date) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT (extract(year FROM age(p_on, p_dob)) * 12 + extract(month FROM age(p_on, p_dob)))::integer
$$;
--> statement-breakpoint

-- Next student number for a branch: "<code>-0001". Numbers are organization-wide unique,
-- so the scan ignores row-level security.
CREATE OR REPLACE FUNCTION app_next_student_no(p_branch uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
  v_next integer;
BEGIN
  SELECT code INTO v_code FROM branch WHERE id = p_branch;
  IF v_code IS NULL THEN RAISE EXCEPTION 'unknown branch'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('student_no:' || v_code));
  SELECT coalesce(max(substring(student_no FROM '[0-9]+$')::integer), 0) + 1 INTO v_next
  FROM student WHERE student_no ~ ('^' || v_code || '-[0-9]+$');
  RETURN v_code || '-' || lpad(v_next::text, 4, '0');
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_next_family_no(p_branch uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
  v_next integer;
BEGIN
  SELECT code INTO v_code FROM branch WHERE id = p_branch;
  IF v_code IS NULL THEN RAISE EXCEPTION 'unknown branch'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('family_no:' || v_code));
  SELECT coalesce(max(substring(account_no FROM '[0-9]+$')::integer), 0) + 1 INTO v_next
  FROM family WHERE account_no ~ ('^' || v_code || '-F[0-9]+$');
  RETURN v_code || '-F' || lpad(v_next::text, 4, '0');
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- branch_id on child tables is copied from the parent row, never trusted from the app
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_branch_from_parent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'guardian' THEN
    SELECT branch_id INTO NEW.branch_id FROM family WHERE id = NEW.family_id;
  ELSIF TG_TABLE_NAME = 'user_room' THEN
    SELECT branch_id INTO NEW.branch_id FROM room WHERE id = NEW.room_id;
  ELSE
    SELECT branch_id INTO NEW.branch_id FROM student WHERE id = NEW.student_id;
  END IF;
  IF NEW.branch_id IS NULL THEN RAISE EXCEPTION 'parent row not found' USING ERRCODE = '23503'; END IF;

  IF TG_TABLE_NAME = 'student_guardian' THEN
    IF NOT EXISTS (SELECT 1 FROM guardian g WHERE g.id = NEW.guardian_id AND g.branch_id = NEW.branch_id) THEN
      RAISE EXCEPTION 'guardian belongs to another branch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER guardian_branch BEFORE INSERT OR UPDATE OF family_id, branch_id ON guardian
  FOR EACH ROW EXECUTE FUNCTION app_branch_from_parent();
--> statement-breakpoint
CREATE TRIGGER user_room_branch BEFORE INSERT OR UPDATE ON user_room
  FOR EACH ROW EXECUTE FUNCTION app_branch_from_parent();
--> statement-breakpoint
CREATE TRIGGER student_guardian_branch BEFORE INSERT OR UPDATE OF student_id, guardian_id, branch_id ON student_guardian
  FOR EACH ROW EXECUTE FUNCTION app_branch_from_parent();
--> statement-breakpoint
CREATE TRIGGER student_medical_branch BEFORE INSERT OR UPDATE OF student_id, branch_id ON student_medical
  FOR EACH ROW EXECUTE FUNCTION app_branch_from_parent();
--> statement-breakpoint
CREATE TRIGGER consent_record_branch BEFORE INSERT OR UPDATE OF student_id, branch_id ON consent_record
  FOR EACH ROW EXECUTE FUNCTION app_branch_from_parent();
--> statement-breakpoint

-- A child and their family account belong to the same branch.
CREATE OR REPLACE FUNCTION app_student_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM family f WHERE f.id = NEW.family_id AND f.branch_id = NEW.branch_id) THEN
    RAISE EXCEPTION 'family belongs to another branch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER student_check BEFORE INSERT OR UPDATE OF family_id, branch_id ON student
  FOR EACH ROW EXECUTE FUNCTION app_student_check();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Enrollment rules: age 3 months to 4.5 years, room band (or a reason), licence cap (spec D11)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_enrollment_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dob date;
  v_student_branch uuid;
  v_room_branch uuid;
  v_band_min integer;
  v_band_max integer;
  v_age integer;
  v_licensed integer;
  v_active integer;
BEGIN
  IF NEW.status NOT IN ('active', 'pending_approval') THEN RETURN NEW; END IF;

  SELECT date_of_birth, branch_id INTO v_dob, v_student_branch FROM student WHERE id = NEW.student_id;
  SELECT r.branch_id, b.min_age_months, b.max_age_months INTO v_room_branch, v_band_min, v_band_max
  FROM room r JOIN age_band b ON b.id = r.age_band_id WHERE r.id = NEW.room_id;

  IF v_room_branch IS DISTINCT FROM NEW.branch_id OR v_student_branch IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'room or child belongs to another branch' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.room_id IS DISTINCT FROM OLD.room_id THEN
    -- Spec §2.1: under 3 months cannot be enrolled; the licence ends at 54 months.
    v_age := app_age_months(v_dob, NEW.start_date);
    IF NEW.start_date >= current_date AND (v_age < 3 OR v_age >= 54) THEN
      RAISE EXCEPTION 'age_out_of_range' USING ERRCODE = '23514';
    END IF;
    -- A room of another age band needs a written reason (spec §2.1).
    v_age := app_age_months(v_dob, greatest(NEW.start_date, current_date));
    IF (v_age < v_band_min OR v_age >= v_band_max) AND coalesce(trim(NEW.band_override_reason), '') = '' THEN
      RAISE EXCEPTION 'band_reason_required' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active' OR OLD.branch_id <> NEW.branch_id) THEN
    -- Serialize enrollments per branch so two saves cannot both take the last place.
    SELECT licensed_capacity INTO v_licensed FROM branch WHERE id = NEW.branch_id FOR UPDATE;
    SELECT count(*) INTO v_active FROM enrollment
    WHERE branch_id = NEW.branch_id AND status = 'active' AND id <> NEW.id;
    IF v_active + 1 > v_licensed AND NOT EXISTS (
      SELECT 1 FROM approval_request a
      WHERE a.id = NEW.approval_request_id AND a.type = 'over_capacity' AND a.status = 'approved' AND a.branch_id = NEW.branch_id
    ) THEN
      RAISE EXCEPTION 'over_capacity' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER enrollment_check BEFORE INSERT OR UPDATE ON enrollment
  FOR EACH ROW EXECUTE FUNCTION app_enrollment_check();
--> statement-breakpoint

-- The child's status follows their latest enrollment.
CREATE OR REPLACE FUNCTION app_student_status_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  SELECT CASE
    WHEN bool_or(e.status = 'active') THEN 'active'
    WHEN bool_or(e.status = 'pending_approval') THEN 'pending'
    ELSE coalesce(
      (SELECT e2.status FROM enrollment e2
       WHERE e2.student_id = NEW.student_id AND e2.status IN ('withdrawn', 'graduated')
       ORDER BY e2.end_date DESC NULLS FIRST, e2.updated_at DESC LIMIT 1),
      'pending')
  END INTO v_status
  FROM enrollment e WHERE e.student_id = NEW.student_id;
  UPDATE student SET status = v_status WHERE id = NEW.student_id AND status IS DISTINCT FROM v_status;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER enrollment_student_status AFTER INSERT OR UPDATE ON enrollment
  FOR EACH ROW EXECUTE FUNCTION app_student_status_sync();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Decisions (nobody approves their own request, spec §5)
-- ---------------------------------------------------------------------------

-- Owner decides an over-capacity enrollment.
CREATE OR REPLACE FUNCTION app_decide_over_capacity(p_request uuid, p_approve boolean, p_note text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req approval_request%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM approval_request WHERE id = p_request FOR UPDATE;
  IF v_req.id IS NULL OR v_req.type <> 'over_capacity' OR v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514';
  END IF;
  IF NOT app_is_owner() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v_req.created_by = app_current_user_id() THEN RAISE EXCEPTION 'own_request' USING ERRCODE = '42501'; END IF;

  UPDATE approval_request
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
      decided_by = app_current_user_id(), decided_at = now(), decision_note = nullif(trim(p_note), '')
  WHERE id = p_request;

  UPDATE enrollment
  SET status = CASE WHEN p_approve THEN 'active' ELSE 'declined' END,
      approval_request_id = p_request
  WHERE id = v_req.enrollment_id AND status = 'pending_approval';
END
$$;
--> statement-breakpoint

-- The receiving branch manager accepts or declines a transfer (spec §8.1).
-- The child keeps one record; the old enrollment closes, a new one opens, history stays.
-- If brothers or sisters stay behind, the family account and this child's guardians are copied
-- to the new branch; otherwise the whole family moves.
CREATE OR REPLACE FUNCTION app_decide_transfer(
  p_request uuid, p_accept boolean, p_room uuid, p_start date, p_note text, p_band_reason text
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req approval_request%ROWTYPE;
  v_student student%ROWTYPE;
  v_to uuid;
  v_new_family uuid;
  v_g record;
  v_new_guardian uuid;
BEGIN
  SELECT * INTO v_req FROM approval_request WHERE id = p_request FOR UPDATE;
  IF v_req.id IS NULL OR v_req.type <> 'transfer' OR v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514';
  END IF;
  v_to := v_req.to_branch_id;
  IF NOT app_has_role_in(v_to, ARRAY['branch_manager']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_req.created_by = app_current_user_id() THEN RAISE EXCEPTION 'own_request' USING ERRCODE = '42501'; END IF;

  UPDATE approval_request
  SET status = CASE WHEN p_accept THEN 'approved' ELSE 'declined' END,
      decided_by = app_current_user_id(), decided_at = now(), decision_note = nullif(trim(p_note), '')
  WHERE id = p_request;
  IF NOT p_accept THEN RETURN; END IF;

  SELECT * INTO v_student FROM student WHERE id = v_req.student_id FOR UPDATE;

  UPDATE enrollment SET status = 'transferred', end_date = p_start - 1, end_reason = 'transfer'
  WHERE student_id = v_student.id AND status IN ('active', 'pending_approval');

  IF EXISTS (
    SELECT 1 FROM student s JOIN enrollment e ON e.student_id = s.id AND e.status IN ('active', 'pending_approval')
    WHERE s.family_id = v_student.family_id AND s.id <> v_student.id
  ) THEN
    INSERT INTO family (branch_id, account_no, display_name, notes, is_demo)
    SELECT v_to, app_next_family_no(v_to), display_name, notes, is_demo
    FROM family WHERE id = v_student.family_id RETURNING id INTO v_new_family;
    UPDATE student SET branch_id = v_to, family_id = v_new_family WHERE id = v_student.id;

    FOR v_g IN
      SELECT g.*, sg.can_pick_up, sg.is_primary_contact FROM guardian g
      JOIN student_guardian sg ON sg.guardian_id = g.id AND sg.student_id = v_student.id
    LOOP
      INSERT INTO guardian (family_id, branch_id, full_name, relationship, phone, national_id_last4, photo_attachment_id, is_demo)
      VALUES (v_new_family, v_to, v_g.full_name, v_g.relationship, v_g.phone, v_g.national_id_last4, v_g.photo_attachment_id, v_g.is_demo)
      RETURNING id INTO v_new_guardian;
      DELETE FROM student_guardian WHERE student_id = v_student.id AND guardian_id = v_g.id;
      INSERT INTO student_guardian (student_id, guardian_id, branch_id, can_pick_up, is_primary_contact)
      VALUES (v_student.id, v_new_guardian, v_to, v_g.can_pick_up, v_g.is_primary_contact);
      UPDATE consent_record SET guardian_id = v_new_guardian WHERE student_id = v_student.id AND guardian_id = v_g.id;
    END LOOP;
  ELSE
    UPDATE family SET branch_id = v_to WHERE id = v_student.family_id;
    UPDATE guardian SET branch_id = v_to WHERE family_id = v_student.family_id;
    UPDATE student SET branch_id = v_to WHERE family_id = v_student.family_id;
    UPDATE student_guardian SET branch_id = v_to
    WHERE student_id IN (SELECT id FROM student WHERE family_id = v_student.family_id);
    UPDATE student_medical SET branch_id = v_to
    WHERE student_id IN (SELECT id FROM student WHERE family_id = v_student.family_id);
    UPDATE consent_record SET branch_id = v_to
    WHERE student_id IN (SELECT id FROM student WHERE family_id = v_student.family_id);
  END IF;

  UPDATE student_medical SET branch_id = v_to WHERE student_id = v_student.id;
  UPDATE consent_record SET branch_id = v_to WHERE student_id = v_student.id;
  UPDATE attachment SET branch_id = v_to
  WHERE id IN (
    SELECT form_attachment_id FROM consent_record WHERE student_id = v_student.id
    UNION SELECT photo_attachment_id FROM student WHERE id = v_student.id
    UNION SELECT g.photo_attachment_id FROM guardian g
      JOIN student_guardian sg ON sg.guardian_id = g.id AND sg.student_id = v_student.id
  );

  INSERT INTO enrollment (student_id, branch_id, room_id, start_date, status, band_override_reason, is_demo)
  VALUES (v_student.id, v_to, p_room, p_start, 'active', nullif(trim(p_band_reason), ''), v_student.is_demo);
END
$$;
--> statement-breakpoint

-- Owner or company manager reads a child's medical notes after typing a reason (spec §5 "break-glass").
-- Every use is written to the audit log.
CREATE OR REPLACE FUNCTION app_break_glass_medical(p_student uuid, p_reason text)
RETURNS SETOF student_medical
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
BEGIN
  SELECT branch_id INTO v_branch FROM student WHERE id = p_student;
  IF v_branch IS NULL OR NOT app_has_role_in(v_branch, ARRAY['owner', 'company_manager']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '23514'; END IF;
  INSERT INTO audit_event (actor_user_id, branch_id, table_name, row_id, action, reason)
  VALUES (app_current_user_id(), v_branch, 'student_medical', p_student::text, 'break_glass', trim(p_reason));
  RETURN QUERY SELECT * FROM student_medical WHERE student_id = p_student;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit: medical text and file contents never go into the audit log
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_redact(p_table text, p_row jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_row IS NULL THEN NULL
    WHEN p_table = 'attachment' THEN p_row - 'data'
    WHEN p_table = 'student_medical' THEN p_row
      || jsonb_build_object(
        'allergies', CASE WHEN p_row ->> 'allergies' IS NULL THEN NULL ELSE md5(p_row ->> 'allergies') END,
        'conditions', CASE WHEN p_row ->> 'conditions' IS NULL THEN NULL ELSE md5(p_row ->> 'conditions') END,
        'medications', CASE WHEN p_row ->> 'medications' IS NULL THEN NULL ELSE md5(p_row ->> 'medications') END,
        'doctor_contact', CASE WHEN p_row ->> 'doctor_contact' IS NULL THEN NULL ELSE md5(p_row ->> 'doctor_contact') END)
    ELSE p_row
  END
$$;
--> statement-breakpoint

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

  -- Ignore updates that change nothing but the bookkeeping columns.
  IF TG_OP = 'UPDATE'
     AND (v_before - 'updated_at' - 'updated_by') = (v_after - 'updated_at' - 'updated_by') THEN
    RETURN NULL;
  END IF;

  v_row := coalesce(v_after, v_before);
  v_row_id := coalesce(
    v_row ->> 'id',
    v_row ->> 'student_id',
    CASE WHEN TG_TABLE_NAME = 'user_room' THEN concat_ws('/', v_row ->> 'user_id', v_row ->> 'room_id') END,
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
    'user_room', 'import_batch', 'attachment', 'family', 'guardian', 'student', 'student_guardian',
    'student_medical', 'consent_record', 'approval_request', 'enrollment', 'waitlist_entry'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()',
      t || '_audit', t
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_columns()',
      t || '_set_updated', t
    );
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON user_room, import_batch, attachment, family, guardian, student, student_guardian,
  student_medical, consent_record, approval_request, enrollment, waitlist_entry TO yanmu_app;
--> statement-breakpoint
GRANT DELETE ON user_room, family, guardian, student, student_guardian, enrollment TO yanmu_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_next_student_no(uuid), app_next_family_no(uuid), app_age_months(date, date),
  app_decide_over_capacity(uuid, boolean, text), app_decide_transfer(uuid, boolean, uuid, date, text, text),
  app_break_glass_medical(uuid, text) TO yanmu_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

CREATE POLICY user_room_read ON user_room FOR SELECT TO yanmu_app
  USING (user_id = app_current_user_id() OR app_is_org_admin()
         OR app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]));
--> statement-breakpoint
CREATE POLICY user_room_insert ON user_room FOR INSERT TO yanmu_app WITH CHECK (app_is_org_admin());
--> statement-breakpoint
CREATE POLICY user_room_update ON user_room FOR UPDATE TO yanmu_app USING (false);
--> statement-breakpoint
CREATE POLICY user_room_delete ON user_room FOR DELETE TO yanmu_app USING (app_is_org_admin());
--> statement-breakpoint

CREATE POLICY import_batch_read ON import_batch FOR SELECT TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[]));
--> statement-breakpoint
CREATE POLICY import_batch_insert ON import_batch FOR INSERT TO yanmu_app WITH CHECK (app_child_importer(branch_id));
--> statement-breakpoint
CREATE POLICY import_batch_update ON import_batch FOR UPDATE TO yanmu_app
  USING (app_child_importer(branch_id)) WITH CHECK (app_child_importer(branch_id));
--> statement-breakpoint

CREATE POLICY attachment_read ON attachment FOR SELECT TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager', 'front_desk', 'teacher']::app_role[]));
--> statement-breakpoint
CREATE POLICY attachment_insert ON attachment FOR INSERT TO yanmu_app WITH CHECK (app_child_writer(branch_id));
--> statement-breakpoint
CREATE POLICY attachment_update ON attachment FOR UPDATE TO yanmu_app USING (false);
--> statement-breakpoint

CREATE POLICY family_read ON family FOR SELECT TO yanmu_app
  USING (app_child_viewer(branch_id) OR app_teacher_sees_family(id));
--> statement-breakpoint
CREATE POLICY family_insert ON family FOR INSERT TO yanmu_app
  WITH CHECK (app_child_writer(branch_id) OR (import_batch_id IS NOT NULL AND app_child_importer(branch_id)));
--> statement-breakpoint
CREATE POLICY family_update ON family FOR UPDATE TO yanmu_app
  USING (app_child_writer(branch_id)) WITH CHECK (app_child_writer(branch_id));
--> statement-breakpoint
CREATE POLICY family_delete ON family FOR DELETE TO yanmu_app
  USING (import_batch_id IS NOT NULL AND app_child_importer(branch_id));
--> statement-breakpoint

CREATE POLICY guardian_read ON guardian FOR SELECT TO yanmu_app
  USING (app_child_viewer(branch_id) OR app_teacher_sees_family(family_id));
--> statement-breakpoint
CREATE POLICY guardian_insert ON guardian FOR INSERT TO yanmu_app
  WITH CHECK (app_child_writer(branch_id) OR (import_batch_id IS NOT NULL AND app_child_importer(branch_id)));
--> statement-breakpoint
CREATE POLICY guardian_update ON guardian FOR UPDATE TO yanmu_app
  USING (app_child_writer(branch_id)) WITH CHECK (app_child_writer(branch_id));
--> statement-breakpoint
CREATE POLICY guardian_delete ON guardian FOR DELETE TO yanmu_app
  USING (import_batch_id IS NOT NULL AND app_child_importer(branch_id));
--> statement-breakpoint

CREATE POLICY student_read ON student FOR SELECT TO yanmu_app
  USING (app_child_viewer(branch_id) OR app_teacher_sees_student(id));
--> statement-breakpoint
CREATE POLICY student_insert ON student FOR INSERT TO yanmu_app
  WITH CHECK (app_child_writer(branch_id) OR (import_batch_id IS NOT NULL AND app_child_importer(branch_id)));
--> statement-breakpoint
CREATE POLICY student_update ON student FOR UPDATE TO yanmu_app
  USING (app_child_writer(branch_id)) WITH CHECK (app_child_writer(branch_id));
--> statement-breakpoint
CREATE POLICY student_delete ON student FOR DELETE TO yanmu_app
  USING (import_batch_id IS NOT NULL AND app_child_importer(branch_id));
--> statement-breakpoint

CREATE POLICY student_guardian_read ON student_guardian FOR SELECT TO yanmu_app
  USING (app_child_viewer(branch_id) OR app_teacher_sees_student(student_id));
--> statement-breakpoint
CREATE POLICY student_guardian_insert ON student_guardian FOR INSERT TO yanmu_app
  WITH CHECK (app_child_writer(branch_id) OR app_child_importer(branch_id));
--> statement-breakpoint
CREATE POLICY student_guardian_update ON student_guardian FOR UPDATE TO yanmu_app
  USING (app_child_writer(branch_id)) WITH CHECK (app_child_writer(branch_id));
--> statement-breakpoint
CREATE POLICY student_guardian_delete ON student_guardian FOR DELETE TO yanmu_app
  USING (app_child_writer(branch_id));
--> statement-breakpoint

CREATE POLICY student_medical_read ON student_medical FOR SELECT TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]) OR app_teacher_sees_student(student_id));
--> statement-breakpoint
CREATE POLICY student_medical_insert ON student_medical FOR INSERT TO yanmu_app
  WITH CHECK (app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]));
--> statement-breakpoint
CREATE POLICY student_medical_update ON student_medical FOR UPDATE TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]))
  WITH CHECK (app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]));
--> statement-breakpoint

CREATE POLICY consent_record_read ON consent_record FOR SELECT TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager', 'front_desk']::app_role[])
         OR app_teacher_sees_student(student_id));
--> statement-breakpoint
CREATE POLICY consent_record_insert ON consent_record FOR INSERT TO yanmu_app
  WITH CHECK (app_child_writer(branch_id) OR app_child_importer(branch_id));
--> statement-breakpoint
CREATE POLICY consent_record_update ON consent_record FOR UPDATE TO yanmu_app
  USING (app_child_writer(branch_id)) WITH CHECK (app_child_writer(branch_id));
--> statement-breakpoint

-- Approval requests: the branch's managers, the receiving branch for transfers, and whoever asked.
CREATE POLICY approval_request_read ON approval_request FOR SELECT TO yanmu_app
  USING (
    created_by = app_current_user_id()
    OR app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[])
    OR (to_branch_id IS NOT NULL AND app_has_role_in(to_branch_id, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[]))
  );
--> statement-breakpoint
CREATE POLICY approval_request_insert ON approval_request FOR INSERT TO yanmu_app
  WITH CHECK (app_child_writer(branch_id) AND status = 'pending' AND decided_by IS NULL);
--> statement-breakpoint
-- Decisions go through app_decide_* functions; the requester may only cancel.
CREATE POLICY approval_request_update ON approval_request FOR UPDATE TO yanmu_app
  USING (created_by = app_current_user_id() AND status = 'pending')
  WITH CHECK (status = 'cancelled' AND decided_by IS NULL);
--> statement-breakpoint

CREATE POLICY enrollment_read ON enrollment FOR SELECT TO yanmu_app
  USING (app_child_viewer(branch_id) OR app_child_viewer(app_student_branch(student_id))
         OR (status = 'active' AND room_id = ANY (app_teacher_room_ids())));
--> statement-breakpoint
CREATE POLICY enrollment_insert ON enrollment FOR INSERT TO yanmu_app
  WITH CHECK (app_child_writer(branch_id) OR (import_batch_id IS NOT NULL AND app_child_importer(branch_id)));
--> statement-breakpoint
CREATE POLICY enrollment_update ON enrollment FOR UPDATE TO yanmu_app
  USING (app_child_writer(branch_id)) WITH CHECK (app_child_writer(branch_id));
--> statement-breakpoint
CREATE POLICY enrollment_delete ON enrollment FOR DELETE TO yanmu_app
  USING (import_batch_id IS NOT NULL AND app_child_importer(branch_id));
--> statement-breakpoint

CREATE POLICY waitlist_entry_read ON waitlist_entry FOR SELECT TO yanmu_app
  USING (app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager', 'front_desk']::app_role[]));
--> statement-breakpoint
CREATE POLICY waitlist_entry_insert ON waitlist_entry FOR INSERT TO yanmu_app WITH CHECK (app_child_writer(branch_id));
--> statement-breakpoint
CREATE POLICY waitlist_entry_update ON waitlist_entry FOR UPDATE TO yanmu_app
  USING (app_child_writer(branch_id)) WITH CHECK (app_child_writer(branch_id));
