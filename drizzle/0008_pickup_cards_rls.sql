-- QR pickup cards (owner's review of phase 3): who may see, issue and cancel them, and audit.
--
--   read    = child viewers of the branch (owner, company manager, branch manager, front desk, accountant)
--             and teachers, for adults of the children in their classes (they scan the cards)
--   issue   = branch manager and front desk (the people who keep the approved-adults list)
--   cancel  = the same; a card is never deleted, only cancelled (revoked_at)
--
-- Only the SHA-256 of the card's code is stored, and it is left out of the audit log.

CREATE OR REPLACE FUNCTION app_teacher_sees_guardian(p_guardian uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM student_guardian sg
    JOIN enrollment e ON e.student_id = sg.student_id AND e.status = 'active'
    WHERE sg.guardian_id = p_guardian AND e.room_id = ANY (app_teacher_room_ids())
  )
$$;
--> statement-breakpoint

-- The card's branch is always the adult's branch; the code and the adult never change, and a
-- cancelled card stays cancelled.
CREATE OR REPLACE FUNCTION app_pickup_card_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT g.branch_id INTO NEW.branch_id FROM guardian g WHERE g.id = NEW.guardian_id;
    IF NEW.branch_id IS NULL THEN
      RAISE EXCEPTION 'unknown guardian' USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.token_hash <> OLD.token_hash OR NEW.guardian_id <> OLD.guardian_id OR NEW.branch_id <> OLD.branch_id
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'pickup cards can only be cancelled' USING ERRCODE = '23514';
  END IF;
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    NEW.revoked_by := app_current_user_id();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pickup_card_check BEFORE INSERT OR UPDATE ON pickup_card
  FOR EACH ROW EXECUTE FUNCTION app_pickup_card_check();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION audit_redact(p_table text, p_row jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_row IS NULL THEN NULL
    WHEN p_table = 'attachment' THEN p_row - 'data'
    WHEN p_table = 'pickup_card' THEN p_row - 'token_hash'
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

CREATE TRIGGER pickup_card_audit AFTER INSERT OR UPDATE OR DELETE ON pickup_card
  FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
CREATE TRIGGER pickup_card_set_updated BEFORE UPDATE ON pickup_card
  FOR EACH ROW EXECUTE FUNCTION set_updated_columns();
--> statement-breakpoint
ALTER TABLE pickup_card ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY pickup_card_read ON pickup_card FOR SELECT TO yanmu_app
  USING (app_child_viewer(branch_id) OR app_teacher_sees_guardian(guardian_id));
--> statement-breakpoint
CREATE POLICY pickup_card_insert ON pickup_card FOR INSERT TO yanmu_app
  WITH CHECK (app_child_writer(branch_id));
--> statement-breakpoint
CREATE POLICY pickup_card_update ON pickup_card FOR UPDATE TO yanmu_app
  USING (app_child_writer(branch_id)) WITH CHECK (app_child_writer(branch_id));
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON pickup_card TO yanmu_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_teacher_sees_guardian(uuid) TO yanmu_app;
