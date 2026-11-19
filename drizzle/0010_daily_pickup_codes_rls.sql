-- Daily pickup QR codes (owner, 2026-11-19): every child gets a new code each day, and an approved
-- adult opens a private link to see today's codes for the children they may collect. The adult shows
-- the code (or a screenshot) at pickup and the front desk scans it.
--
-- From here on a `pickup_card` row is an adult's private pickup link: one in use per adult, only the
-- SHA-256 of the link's secret is stored, and it is made or cancelled by the branch manager or front desk
-- (policies in 0008). The codes themselves are never stored: the app works them out from the child,
-- the date, `student.pickup_code_version` and a server secret.
--
-- The link page is opened by someone who is not signed in, so it reads through this function only:
-- given the hash of a link's secret, it returns the children that adult may collect today, and nothing else.

CREATE OR REPLACE FUNCTION app_pickup_link_children(p_hash text)
RETURNS TABLE (
  guardian_name text,
  student_id uuid,
  full_name_ar text,
  full_name_en text,
  pickup_code_version integer,
  branch_name_ar text,
  branch_name_en text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT g.full_name, s.id, s.full_name_ar, s.full_name_en, s.pickup_code_version, b.name_ar, b.name_en
  FROM pickup_card c
  JOIN guardian g ON g.id = c.guardian_id
  JOIN student_guardian sg ON sg.guardian_id = g.id AND sg.can_pick_up
  JOIN student s ON s.id = sg.student_id
  JOIN enrollment e ON e.student_id = s.id AND e.status = 'active'
  JOIN branch b ON b.id = s.branch_id AND b.is_active
  WHERE c.token_hash = p_hash AND c.revoked_at IS NULL
  ORDER BY s.full_name_en
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_pickup_link_children(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_pickup_link_children(text) TO yanmu_app;
