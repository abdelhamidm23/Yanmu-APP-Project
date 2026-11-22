-- QR pickup is out of the app for now (owner, 2026-11-22): parents already use a separate app that
-- gives each child a new pickup code every day. Pickup here is by the approved-adults list only.
--
-- A demo database that ran the QR pickup steps of the review branch (pickup cards and links, daily
-- codes) is cleaned here; on any other database every statement does nothing.

DROP FUNCTION IF EXISTS app_pickup_link_children(text);
--> statement-breakpoint
DROP TABLE IF EXISTS pickup_card;
--> statement-breakpoint
DROP FUNCTION IF EXISTS app_pickup_card_check();
--> statement-breakpoint
DROP FUNCTION IF EXISTS app_teacher_sees_guardian(uuid);
--> statement-breakpoint
ALTER TABLE student DROP COLUMN IF EXISTS pickup_code_version;
--> statement-breakpoint
ALTER TABLE student_attendance DROP COLUMN IF EXISTS check_out_method;
--> statement-breakpoint

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
