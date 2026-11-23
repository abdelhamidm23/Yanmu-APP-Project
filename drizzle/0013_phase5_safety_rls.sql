-- Phase 5: incidents, issues and alerts (spec §5, §7.6, §8.7, §8.8, §10).
--
--   incidents  = teacher (own classes) and front desk report; branch manager (own branch) and company
--                manager manage; owner reads and signs off the closure of every critical incident.
--                Reporters keep seeing what they reported. Accountant and HR have no access.
--   issues     = teacher and front desk report; branch manager (own branch) and company manager assign
--                and set due dates; the person an issue is assigned to can move it on; owner reads.
--   alerts     = raised by the database itself (incidents, pickup refusals, ratio breaches, cash box
--                differences, unusual expense requests, children still in after hours). Critical
--                alerts reach everyone at once and repeat until one person acknowledges; the rest go
--                step by step (branch manager → company manager after 30 min → owner after 2 h).
--
-- Status changes (seen, report submitted, reviewed, closed, action done, alert acknowledged) go through
-- the SECURITY DEFINER functions below; the app may only edit the report's own fields.

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_incident_manager(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['branch_manager', 'company_manager']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_safety_viewer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_safety_reporter(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['teacher', 'front_desk', 'branch_manager', 'company_manager']::app_role[])
$$;
--> statement-breakpoint
-- An incident this person may see: managers and the owner of its branch, or the person who reported it.
CREATE OR REPLACE FUNCTION app_incident_visible(p_incident uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM incident i WHERE i.id = p_incident
      AND (app_safety_viewer(i.branch_id) OR i.created_by = app_current_user_id())
  )
$$;
--> statement-breakpoint
-- An incident this person may add people, photos and report text to: managers, or the reporter while open.
CREATE OR REPLACE FUNCTION app_incident_editable(p_incident uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM incident i WHERE i.id = p_incident AND i.status <> 'closed'
      AND (app_incident_manager(i.branch_id) OR i.created_by = app_current_user_id())
  )
$$;
--> statement-breakpoint

-- People who hold a role in a branch (or across all branches), for assigning issues and actions.
CREATE OR REPLACE FUNCTION app_branch_people(p_branch uuid)
RETURNS TABLE (id uuid, full_name text, roles text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.full_name, string_agg(DISTINCT r.role::text, ',' ORDER BY r.role::text)
  FROM user_branch_role r JOIN app_user u ON u.id = r.user_id
  WHERE (r.branch_id = p_branch OR r.branch_id IS NULL)
    AND (u.end_date IS NULL OR u.end_date > app_cairo_today())
    AND app_incident_manager(p_branch)
  GROUP BY u.id, u.full_name
  ORDER BY u.full_name
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Alerts (spec §10)
-- ---------------------------------------------------------------------------

-- Active people with one of these roles in the branch or across all branches.
CREATE OR REPLACE FUNCTION app_alert_people(p_branch uuid, p_roles app_role[]) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT u.id
  FROM user_branch_role r JOIN app_user u ON u.id = r.user_id
  WHERE r.role = ANY (p_roles) AND (r.branch_id = p_branch OR r.branch_id IS NULL)
    AND (u.end_date IS NULL OR u.end_date > app_cairo_today())
$$;
--> statement-breakpoint

-- Who hears about an alert at each step, and how many minutes after it was raised (spec §10, §17.3).
-- Critical alerts have one step: everyone at once (the reporter is added by the caller).
CREATE OR REPLACE FUNCTION app_alert_steps(p_branch uuid, p_key text)
RETURNS TABLE (step integer, roles app_role[], after_minutes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cm integer := coalesce(app_setting_bigint(p_branch, 'alerts.step_to_company_manager_minutes', 30), 30)::integer;
  v_owner integer := coalesce(app_setting_bigint(p_branch, 'alerts.step_to_owner_minutes', 120), 120)::integer;
BEGIN
  IF p_key IN ('critical_incident') THEN
    RETURN QUERY VALUES (1, ARRAY['branch_manager', 'company_manager', 'owner']::app_role[], 0);
  ELSIF p_key = 'incident' THEN
    -- Non-critical incidents: branch manager; not looked at within 24 hours → company manager.
    RETURN QUERY VALUES (1, ARRAY['branch_manager']::app_role[], 0), (2, ARRAY['company_manager']::app_role[], 1440);
  ELSIF p_key = 'cash_variance' THEN
    -- Money is for the accountant, owner and company manager (owner, 2026-11-23).
    RETURN QUERY VALUES (1, ARRAY['accountant']::app_role[], 0), (2, ARRAY['company_manager']::app_role[], v_cm), (3, ARRAY['owner']::app_role[], v_owner);
  ELSIF p_key = 'expense_approval' THEN
    RETURN QUERY VALUES (1, ARRAY['company_manager']::app_role[], 0), (2, ARRAY['owner']::app_role[], v_owner);
  ELSIF p_key = 'daily_close_missing' THEN
    RETURN QUERY VALUES (1, ARRAY['company_manager']::app_role[], 0);
  ELSIF p_key = 'daily_close_prompt' THEN
    RETURN QUERY VALUES (1, ARRAY['branch_manager']::app_role[], 0);
  ELSE
    -- ratio_breach, still_checked_in and anything else of the same day.
    RETURN QUERY VALUES (1, ARRAY['branch_manager']::app_role[], 0), (2, ARRAY['company_manager']::app_role[], v_cm), (3, ARRAY['owner']::app_role[], v_owner);
  END IF;
END
$$;
--> statement-breakpoint

-- Quiet hours (22:00–07:00 by default, spec §10): a non-critical push waits until they end.
CREATE OR REPLACE FUNCTION app_after_quiet_hours(p_branch uuid, p_at timestamptz) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start time := coalesce(app_setting(p_branch, 'alerts.quiet_hours_start') #>> '{}', '22:00')::time;
  v_end time := coalesce(app_setting(p_branch, 'alerts.quiet_hours_end') #>> '{}', '07:00')::time;
  v_local timestamp := p_at AT TIME ZONE 'Africa/Cairo';
  v_t time := v_local::time;
BEGIN
  IF v_start = v_end THEN RETURN p_at; END IF;
  IF v_start > v_end THEN
    -- Overnight window, e.g. 22:00 to 07:00.
    IF v_t >= v_start THEN RETURN ((v_local::date + 1) + v_end) AT TIME ZONE 'Africa/Cairo'; END IF;
    IF v_t < v_end THEN RETURN (v_local::date + v_end) AT TIME ZONE 'Africa/Cairo'; END IF;
  ELSIF v_t >= v_start AND v_t < v_end THEN
    RETURN (v_local::date + v_end) AT TIME ZONE 'Africa/Cairo';
  END IF;
  RETURN p_at;
END
$$;
--> statement-breakpoint

-- Tells these people about the alert: one in-app notification each (kept, read again when it repeats)
-- and a push (plus an SMS when critical) to send.
CREATE OR REPLACE FUNCTION app_alert_notify(p_alert uuid, p_users uuid[], p_step integer) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_a alert%ROWTYPE;
  v_due timestamptz;
  v_n integer := 0;
  v_note uuid;
  v_user uuid;
BEGIN
  SELECT * INTO v_a FROM alert WHERE id = p_alert;
  v_due := CASE WHEN v_a.tier = 'critical' THEN now() ELSE app_after_quiet_hours(v_a.branch_id, now()) END;
  FOREACH v_user IN ARRAY coalesce(p_users, '{}') LOOP
    CONTINUE WHEN v_user IS NULL;
    INSERT INTO notification (alert_id, branch_id, user_id, step, created_by, updated_by)
    VALUES (p_alert, v_a.branch_id, v_user, p_step, NULL, NULL)
    ON CONFLICT (alert_id, user_id) DO UPDATE SET read_at = NULL
    RETURNING id INTO v_note;
    INSERT INTO notification_delivery (notification_id, branch_id, channel, due_at) VALUES (v_note, v_a.branch_id, 'push', v_due);
    IF v_a.tier = 'critical' THEN
      INSERT INTO notification_delivery (notification_id, branch_id, channel, due_at) VALUES (v_note, v_a.branch_id, 'sms', v_due);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  UPDATE alert SET last_sent_at = now(), send_count = send_count + 1 WHERE id = p_alert;
  RETURN v_n;
END
$$;
--> statement-breakpoint

-- Raises an alert once (dedupe key) and tells the first step. Critical alerts also reach the safeguarding
-- leads and the extra people given (the person who reported it).
CREATE OR REPLACE FUNCTION app_raise_alert(
  p_branch uuid, p_key text, p_tier text, p_subject_table text, p_subject_id uuid, p_dedupe text,
  p_extra uuid[] DEFAULT '{}', p_demo boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_users uuid[];
  v_next integer;
BEGIN
  INSERT INTO alert (branch_id, key, tier, subject_table, subject_id, dedupe_key, is_demo, created_by, updated_by)
  VALUES (p_branch, p_key, p_tier, p_subject_table, p_subject_id, p_dedupe, p_demo, NULL, NULL)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;

  SELECT array_agg(DISTINCT u) INTO v_users FROM (
    SELECT app_alert_people(p_branch, s.roles) AS u FROM app_alert_steps(p_branch, p_key) s WHERE s.step = 1
    UNION SELECT unnest(p_extra)
    UNION SELECT u.id FROM app_user u
      WHERE p_tier = 'critical' AND u.is_safeguarding_lead
        AND (u.end_date IS NULL OR u.end_date > app_cairo_today())
        AND EXISTS (SELECT 1 FROM user_branch_role r WHERE r.user_id = u.id AND (r.branch_id = p_branch OR r.branch_id IS NULL))
  ) x WHERE u IS NOT NULL;
  PERFORM app_alert_notify(v_id, v_users, 1);

  SELECT min(after_minutes) INTO v_next FROM app_alert_steps(p_branch, p_key) WHERE step = 2;
  IF v_next IS NOT NULL AND p_tier <> 'critical' THEN
    UPDATE alert SET next_step_at = raised_at + make_interval(mins => v_next) WHERE id = v_id;
  END IF;
  RETURN v_id;
END
$$;
--> statement-breakpoint

-- Resolves the open alerts about this record: nothing more is sent about them.
CREATE OR REPLACE FUNCTION app_resolve_alerts(p_subject uuid, p_keys text[]) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE alert SET resolved_at = now() WHERE subject_id = p_subject AND key = ANY (p_keys) AND resolved_at IS NULL
$$;
--> statement-breakpoint

-- One person says "I have this": repeats and escalation stop for everyone (spec §10). It does not close
-- what the alert is about.
CREATE OR REPLACE FUNCTION app_ack_alert(p_alert uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_a alert%ROWTYPE;
BEGIN
  SELECT * INTO v_a FROM alert WHERE id = p_alert FOR UPDATE;
  IF v_a.id IS NULL OR NOT (
    EXISTS (SELECT 1 FROM notification n WHERE n.alert_id = p_alert AND n.user_id = app_current_user_id())
    OR app_has_role_in(v_a.branch_id, ARRAY['owner', 'company_manager']::app_role[])
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_a.acknowledged_at IS NULL THEN
    UPDATE alert SET acknowledged_at = now(), acknowledged_by = app_current_user_id() WHERE id = p_alert;
  END IF;
  UPDATE notification SET read_at = coalesce(read_at, now()) WHERE alert_id = p_alert AND user_id = app_current_user_id();
  UPDATE notification_delivery d SET status = 'skipped', detail = 'acknowledged'
  FROM notification n WHERE d.notification_id = n.id AND n.alert_id = p_alert AND d.status = 'pending';
END
$$;
--> statement-breakpoint

-- Alerts that depend on the time of day. Phase 6 adds the daily close prompt and the missing close.
CREATE OR REPLACE FUNCTION app_time_alerts() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b record;
  v_today date := app_cairo_today();
  v_now time := (now() AT TIME ZONE 'Africa/Cairo')::time;
  v_until time;
BEGIN
  FOR v_b IN SELECT id FROM branch WHERE is_active LOOP
    CONTINUE WHEN NOT is_working_day(v_b.id, v_today);
    -- Children still checked in after the after-school time (spec §8.2): branch manager, then up.
    v_until := coalesce(app_setting(v_b.id, 'attendance.closing_time') #>> '{}', '16:00')::time
             + make_interval(mins => coalesce(app_setting_bigint(v_b.id, 'attendance.after_school_minutes', 60), 60)::integer);
    IF v_now >= v_until AND EXISTS (
      SELECT 1 FROM student_attendance WHERE branch_id = v_b.id AND date = v_today AND status = 'present' AND check_out_at IS NULL
    ) THEN
      PERFORM app_raise_alert(v_b.id, 'still_checked_in', 'same_day', 'branch', v_b.id, format('still_in:%s:%s', v_b.id, v_today));
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

-- The alert job (src/lib/alert-job.ts runs it every minute): resolves what has been handled, moves
-- same-day alerts to the next step, repeats critical alerts nobody has acknowledged, and raises the
-- alerts that depend on the time of day. Runs only without a signed-in person (the job, not a request).
CREATE OR REPLACE FUNCTION app_run_alerts() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_a alert%ROWTYPE;
  v_s record;
  v_users uuid[];
  v_n integer := 0;
  v_today_start timestamptz := app_cairo_today()::timestamp AT TIME ZONE 'Africa/Cairo';
BEGIN
  IF app_current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('app_run_alerts')) THEN RETURN 0; END IF;

  -- 1. Handled: the record behind the alert no longer needs anyone.
  UPDATE alert a SET resolved_at = now()
  WHERE a.resolved_at IS NULL AND (
    (a.key IN ('critical_incident', 'incident') AND EXISTS (SELECT 1 FROM incident i WHERE i.id = a.subject_id AND i.status = 'closed'))
    OR (a.key = 'incident' AND EXISTS (SELECT 1 FROM incident i WHERE i.id = a.subject_id AND i.seen_at IS NOT NULL))
    OR (a.key = 'expense_approval' AND NOT EXISTS (SELECT 1 FROM approval_request r WHERE r.id = a.subject_id AND r.status IN ('pending', 'question')))
    OR (a.key = 'cash_variance' AND EXISTS (SELECT 1 FROM cash_session c WHERE c.id = a.subject_id AND c.reconciled_at IS NOT NULL))
    OR (a.key = 'ratio_breach' AND (a.raised_at < v_today_start OR NOT coalesce((
          SELECT s.is_breach FROM ratio_snapshot s WHERE s.room_id = a.subject_id ORDER BY s.taken_at DESC LIMIT 1), false)))
    OR (a.key = 'still_checked_in' AND (a.raised_at < v_today_start OR NOT EXISTS (
          SELECT 1 FROM student_attendance sa WHERE sa.branch_id = a.branch_id AND sa.date = app_cairo_today()
            AND sa.status = 'present' AND sa.check_out_at IS NULL)))
    OR (a.key = 'issue_assigned' AND EXISTS (SELECT 1 FROM issue i WHERE i.id = a.subject_id AND i.status = 'resolved'))
    OR (a.key = 'action_assigned' AND EXISTS (SELECT 1 FROM incident_action x WHERE x.id = a.subject_id AND x.done_at IS NOT NULL))
    OR (a.tier = 'info' AND a.raised_at < now() - interval '7 days')
  );
  UPDATE notification_delivery d SET status = 'skipped', detail = 'handled'
  FROM notification n JOIN alert a ON a.id = n.alert_id
  WHERE d.notification_id = n.id AND d.status = 'pending' AND (a.resolved_at IS NOT NULL OR a.acknowledged_at IS NOT NULL);
  -- A send that never finished (the server stopped) is tried again.
  UPDATE notification_delivery SET status = 'pending' WHERE status = 'sending' AND due_at < now() - interval '10 minutes';

  -- 2. Step by step: not handled in time → the next person up (spec §10).
  FOR v_a IN
    SELECT * FROM alert WHERE tier = 'same_day' AND resolved_at IS NULL AND acknowledged_at IS NULL
      AND next_step_at IS NOT NULL AND next_step_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO v_s FROM app_alert_steps(v_a.branch_id, v_a.key) WHERE step = v_a.step + 1;
    IF v_s.step IS NULL THEN
      UPDATE alert SET next_step_at = NULL WHERE id = v_a.id;
      CONTINUE;
    END IF;
    SELECT array_agg(u) INTO v_users FROM app_alert_people(v_a.branch_id, v_s.roles) u;
    v_n := v_n + coalesce(app_alert_notify(v_a.id, v_users, v_s.step), 0);
    UPDATE alert SET step = v_s.step,
      next_step_at = (SELECT v_a.raised_at + make_interval(mins => min(x.after_minutes))
                      FROM app_alert_steps(v_a.branch_id, v_a.key) x WHERE x.step = v_s.step + 1)
    WHERE id = v_a.id;
  END LOOP;

  -- 3. Critical: repeat every few minutes until one person acknowledges (spec §10).
  FOR v_a IN
    SELECT * FROM alert WHERE tier = 'critical' AND resolved_at IS NULL AND acknowledged_at IS NULL
      AND last_sent_at <= now() - make_interval(mins => coalesce(app_setting_bigint(branch_id, 'alerts.critical_repeat_minutes', 5), 5)::integer)
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT array_agg(user_id) INTO v_users FROM notification WHERE alert_id = v_a.id;
    v_n := v_n + coalesce(app_alert_notify(v_a.id, v_users, 1), 0);
  END LOOP;

  -- 4. Alerts that depend on the time of day.
  PERFORM app_time_alerts();
  RETURN v_n;
END
$$;
--> statement-breakpoint

-- Push and SMS messages due now, for the sender (src/lib/alert-job.ts). Only the job may ask: phone
-- numbers and phone addresses never reach a signed-in person this way.
CREATE OR REPLACE FUNCTION app_claim_deliveries(p_limit integer)
RETURNS TABLE (id uuid, channel text, user_id uuid, locale text, phone text, alert_key text, tier text,
               branch_ar text, branch_en text, subscriptions jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH c AS (
    SELECT d.id FROM notification_delivery d WHERE d.status = 'pending' AND d.due_at <= now()
    ORDER BY d.due_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE notification_delivery d SET status = 'sending' FROM c WHERE d.id = c.id
    RETURNING d.id, d.channel, d.notification_id
  )
  SELECT u.id, u.channel, n.user_id, au.locale, au.phone, a.key, a.tier, b.name_ar, b.name_en,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth)), '[]'::jsonb)
     FROM push_subscription p WHERE p.user_id = n.user_id)
  FROM u JOIN notification n ON n.id = u.notification_id JOIN alert a ON a.id = n.alert_id
  JOIN app_user au ON au.id = n.user_id JOIN branch b ON b.id = a.branch_id;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_delivery_done(p_delivery uuid, p_status text, p_detail text, p_gone text[] DEFAULT '{}') RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE notification_delivery SET status = p_status, detail = left(p_detail, 200), sent_at = CASE WHEN p_status = 'sent' THEN now() END
  WHERE id = p_delivery;
  -- Phones that no longer accept pushes are forgotten.
  DELETE FROM push_subscription p USING notification_delivery d JOIN notification n ON n.id = d.notification_id
  WHERE d.id = p_delivery AND p.user_id = n.user_id AND p.endpoint = ANY (coalesce(p_gone, '{}'));
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Incidents (spec §8.7)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_incident_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- These are critical by definition (spec §8.7).
  IF NEW.category IN ('head_injury', 'allergic_reaction', 'child_unaccounted', 'pickup_unapproved', 'child_protection') THEN
    NEW.severity := 'critical';
  END IF;
  IF NEW.room_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM room WHERE id = NEW.room_id AND branch_id = NEW.branch_id) THEN
    RAISE EXCEPTION 'class not in branch' USING ERRCODE = '23514';
  END IF;
  IF NEW.occurred_at > now() + interval '10 minutes' THEN RAISE EXCEPTION 'invalid date' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'open';
    NEW.seen_at := NULL; NEW.seen_by := NULL;
    NEW.report_submitted_at := NULL; NEW.report_submitted_by := NULL;
    NEW.reviewed_at := NULL; NEW.reviewed_by := NULL; NEW.review_note := NULL;
    NEW.closed_at := NULL; NEW.closed_by := NULL; NEW.close_note := NULL;
    IF NEW.guardian_notified_at IS NOT NULL THEN NEW.guardian_notified_by := coalesce(app_current_user_id(), NEW.guardian_notified_by); END IF;
  ELSE
    IF OLD.status = 'closed' THEN RAISE EXCEPTION 'already_closed' USING ERRCODE = '23514'; END IF;
    IF NEW.branch_id <> OLD.branch_id THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
    -- A critical incident stays critical: its closure needs the owner's sign-off.
    IF OLD.severity = 'critical' AND NEW.severity <> 'critical' THEN RAISE EXCEPTION 'severity_down' USING ERRCODE = '23514'; END IF;
    IF NEW.guardian_notified_at IS DISTINCT FROM OLD.guardian_notified_at
       OR NEW.guardian_notification_note IS DISTINCT FROM OLD.guardian_notification_note THEN
      NEW.guardian_notified_by := coalesce(app_current_user_id(), NEW.guardian_notified_by);
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER incident_before BEFORE INSERT OR UPDATE ON incident FOR EACH ROW EXECUTE FUNCTION app_incident_before();
--> statement-breakpoint

-- Critical → everyone at once, with the person who reported it. Anything else → the branch manager,
-- then the company manager if nobody has looked within 24 hours (spec §10).
CREATE OR REPLACE FUNCTION app_incident_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.severity = 'critical' THEN
      PERFORM app_raise_alert(NEW.branch_id, 'critical_incident', 'critical', 'incident', NEW.id, 'incident:' || NEW.id, ARRAY[NEW.created_by], NEW.is_demo);
    ELSE
      PERFORM app_raise_alert(NEW.branch_id, 'incident', 'same_day', 'incident', NEW.id, 'incident:' || NEW.id, '{}', NEW.is_demo);
    END IF;
  ELSIF NEW.severity = 'critical' AND OLD.severity <> 'critical' THEN
    PERFORM app_resolve_alerts(NEW.id, ARRAY['incident']);
    PERFORM app_raise_alert(NEW.branch_id, 'critical_incident', 'critical', 'incident', NEW.id, 'incident-critical:' || NEW.id, ARRAY[NEW.created_by], NEW.is_demo);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER incident_after AFTER INSERT OR UPDATE OF severity ON incident FOR EACH ROW EXECUTE FUNCTION app_incident_after();
--> statement-breakpoint

-- People, actions and files take their branch from the incident; children and staff must be of that branch.
CREATE OR REPLACE FUNCTION app_safety_branch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT branch_id INTO NEW.branch_id FROM incident WHERE id = NEW.incident_id;
  IF NEW.branch_id IS NULL THEN RAISE EXCEPTION 'parent not found' USING ERRCODE = '23503'; END IF;
  IF TG_TABLE_NAME = 'incident_person' THEN
    IF NEW.student_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM student WHERE id = NEW.student_id AND branch_id = NEW.branch_id) THEN
      RAISE EXCEPTION 'child not in branch' USING ERRCODE = '23514';
    END IF;
    IF NEW.staff_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff WHERE id = NEW.staff_id AND branch_id = NEW.branch_id) THEN
      RAISE EXCEPTION 'staff not in branch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'incident_action' THEN
    IF NOT EXISTS (SELECT 1 FROM app_alert_people(NEW.branch_id, enum_range(NULL::app_role)) p WHERE p = NEW.owner_user_id) THEN
      RAISE EXCEPTION 'assignee_not_in_branch' USING ERRCODE = '23514';
    END IF;
    NEW.done_at := NULL;
    NEW.done_by := NULL;
  ELSIF TG_TABLE_NAME = 'incident_file' THEN
    IF NOT EXISTS (SELECT 1 FROM attachment WHERE id = NEW.attachment_id AND branch_id = NEW.branch_id) THEN
      RAISE EXCEPTION 'file not in branch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER incident_person_branch BEFORE INSERT ON incident_person FOR EACH ROW EXECUTE FUNCTION app_safety_branch();
--> statement-breakpoint
CREATE TRIGGER incident_action_branch BEFORE INSERT ON incident_action FOR EACH ROW EXECUTE FUNCTION app_safety_branch();
--> statement-breakpoint
CREATE TRIGGER incident_file_branch BEFORE INSERT ON incident_file FOR EACH ROW EXECUTE FUNCTION app_safety_branch();
--> statement-breakpoint

-- The person who owns an action hears about it.
CREATE OR REPLACE FUNCTION app_incident_action_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_user_id IS DISTINCT FROM app_current_user_id() THEN
    PERFORM app_raise_alert(NEW.branch_id, 'action_assigned', 'info', 'incident_action', NEW.id, 'action:' || NEW.id, ARRAY[NEW.owner_user_id], NEW.is_demo);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER incident_action_after AFTER INSERT ON incident_action FOR EACH ROW EXECUTE FUNCTION app_incident_action_after();
--> statement-breakpoint

-- First look by the branch manager, company manager or owner: stops the step-by-step alert.
CREATE OR REPLACE FUNCTION app_incident_seen(p_incident uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_i incident%ROWTYPE;
BEGIN
  SELECT * INTO v_i FROM incident WHERE id = p_incident FOR UPDATE;
  IF v_i.id IS NULL OR NOT app_safety_viewer(v_i.branch_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF v_i.seen_at IS NULL THEN
    UPDATE incident SET seen_at = now(), seen_by = app_current_user_id() WHERE id = p_incident;
  END IF;
  UPDATE alert SET acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, app_current_user_id())
  WHERE subject_id = p_incident AND key = 'incident';
END
$$;
--> statement-breakpoint

-- The full report is done: people, what happened, the guardian told (when a child was involved).
CREATE OR REPLACE FUNCTION app_incident_submit_report(p_incident uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_i incident%ROWTYPE;
BEGIN
  SELECT * INTO v_i FROM incident WHERE id = p_incident FOR UPDATE;
  IF v_i.id IS NULL OR NOT app_incident_editable(p_incident) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF v_i.status <> 'open' THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514'; END IF;
  IF length(btrim(coalesce(v_i.report_details, ''))) < 10 THEN RAISE EXCEPTION 'report_required' USING ERRCODE = '23514'; END IF;
  IF v_i.guardian_notified_at IS NULL AND EXISTS (SELECT 1 FROM incident_person WHERE incident_id = p_incident AND student_id IS NOT NULL) THEN
    RAISE EXCEPTION 'guardian_required' USING ERRCODE = '23514';
  END IF;
  UPDATE incident SET status = 'under_review', report_submitted_at = now(), report_submitted_by = app_current_user_id() WHERE id = p_incident;
END
$$;
--> statement-breakpoint

-- Company manager (or owner) reviews the full report (spec §8.7).
CREATE OR REPLACE FUNCTION app_incident_review(p_incident uuid, p_note text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_i incident%ROWTYPE;
BEGIN
  SELECT * INTO v_i FROM incident WHERE id = p_incident FOR UPDATE;
  IF v_i.id IS NULL OR NOT app_has_role_in(v_i.branch_id, ARRAY['company_manager', 'owner']::app_role[]) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_i.status <> 'under_review' OR v_i.reviewed_at IS NOT NULL THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514'; END IF;
  UPDATE incident SET reviewed_at = now(), reviewed_by = app_current_user_id(), review_note = nullif(btrim(coalesce(p_note, '')), '')
  WHERE id = p_incident;
END
$$;
--> statement-breakpoint

-- Closing: the company manager (or owner) closes a reviewed incident; only the owner signs off a
-- critical one (spec §8.7). Open actions stay on the overdue list until done.
CREATE OR REPLACE FUNCTION app_incident_close(p_incident uuid, p_note text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_i incident%ROWTYPE;
BEGIN
  SELECT * INTO v_i FROM incident WHERE id = p_incident FOR UPDATE;
  IF v_i.id IS NULL OR NOT app_has_role_in(v_i.branch_id, ARRAY['company_manager', 'owner']::app_role[]) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_i.status <> 'under_review' THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514'; END IF;
  IF v_i.reviewed_at IS NULL THEN RAISE EXCEPTION 'review_required' USING ERRCODE = '23514'; END IF;
  IF v_i.severity = 'critical' AND NOT app_has_role_in(v_i.branch_id, ARRAY['owner']::app_role[]) THEN
    RAISE EXCEPTION 'owner_decides' USING ERRCODE = '42501';
  END IF;
  UPDATE incident SET status = 'closed', closed_at = now(), closed_by = app_current_user_id(), close_note = nullif(btrim(coalesce(p_note, '')), '')
  WHERE id = p_incident;
  PERFORM app_resolve_alerts(p_incident, ARRAY['critical_incident', 'incident']);
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_incident_action_done(p_action uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_x incident_action%ROWTYPE;
BEGIN
  SELECT * INTO v_x FROM incident_action WHERE id = p_action FOR UPDATE;
  IF v_x.id IS NULL OR NOT (v_x.owner_user_id = app_current_user_id() OR app_incident_manager(v_x.branch_id)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_x.done_at IS NOT NULL THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514'; END IF;
  UPDATE incident_action SET done_at = now(), done_by = app_current_user_id() WHERE id = p_action;
  PERFORM app_resolve_alerts(p_action, ARRAY['action_assigned']);
END
$$;
--> statement-breakpoint

-- A refused pickup (spec §8.2) is a critical incident (spec §8.7, §10): it is logged as one at once,
-- with the child, so everyone hears and the branch manager completes the report.
CREATE OR REPLACE FUNCTION app_pickup_refusal_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_incident uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO incident (branch_id, room_id, occurred_at, category, severity, description, immediate_action,
                          pickup_refusal_id, is_demo, created_by, updated_by)
    VALUES (NEW.branch_id,
            (SELECT e.room_id FROM enrollment e WHERE e.student_id = NEW.student_id AND e.status = 'active' ORDER BY e.start_date DESC LIMIT 1),
            NEW.happened_at, 'pickup_unapproved', 'critical',
            coalesce(nullif(concat_ws(' · ', nullif(btrim(coalesce(NEW.person_name, '')), ''), nullif(btrim(coalesce(NEW.note, '')), '')), ''), '—'),
            '', NEW.id, NEW.is_demo, NEW.created_by, NEW.created_by)
    RETURNING id INTO v_incident;
    INSERT INTO incident_person (incident_id, branch_id, student_id, role, created_by, updated_by)
    VALUES (v_incident, NEW.branch_id, NEW.student_id, 'involved', NEW.created_by, NEW.created_by);
  ELSIF NEW.acknowledged_at IS NOT NULL AND OLD.acknowledged_at IS NULL THEN
    -- The branch manager acknowledged it on Today: that stops the repeats too.
    UPDATE alert a SET acknowledged_at = coalesce(a.acknowledged_at, now()), acknowledged_by = coalesce(a.acknowledged_by, NEW.acknowledged_by)
    FROM incident i WHERE i.pickup_refusal_id = NEW.id AND a.subject_id = i.id AND a.key = 'critical_incident';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pickup_refusal_after AFTER INSERT OR UPDATE OF acknowledged_at ON pickup_refusal FOR EACH ROW EXECUTE FUNCTION app_pickup_refusal_after();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Same-day alerts from earlier phases (spec §10)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_ratio_snapshot_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_raise_alert(NEW.branch_id, 'ratio_breach', 'same_day', 'room', NEW.room_id,
    format('ratio:%s:%s', NEW.room_id, (NEW.taken_at AT TIME ZONE 'Africa/Cairo')::date), '{}', NEW.is_demo);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ratio_snapshot_alert AFTER INSERT ON ratio_snapshot FOR EACH ROW WHEN (NEW.is_breach) EXECUTE FUNCTION app_ratio_snapshot_alert();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_cash_session_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF abs(coalesce(NEW.variance_piastres, 0)) > app_setting_bigint(NEW.branch_id, 'cash.variance_alert_piastres', 20000) THEN
    PERFORM app_raise_alert(NEW.branch_id, 'cash_variance', 'same_day', 'cash_session', NEW.id, 'cash:' || NEW.id, '{}', NEW.is_demo);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER cash_session_alert AFTER UPDATE OF closed_at ON cash_session FOR EACH ROW
  WHEN (NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL) EXECUTE FUNCTION app_cash_session_alert();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_expense_request_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_raise_alert(NEW.branch_id, 'expense_approval', 'same_day', 'approval_request', NEW.id, 'approval:' || NEW.id, '{}',
    coalesce((SELECT is_demo FROM expense WHERE id = NEW.expense_id), false));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER approval_request_alert AFTER INSERT ON approval_request FOR EACH ROW WHEN (NEW.type = 'expense') EXECUTE FUNCTION app_expense_request_alert();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Issues (spec §8.8)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_issue_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_manager boolean := app_incident_manager(NEW.branch_id) OR app_is_system();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'open';
    NEW.resolved_at := NULL; NEW.resolved_by := NULL; NEW.resolution_note := NULL;
    -- Only the branch manager or company manager assigns and sets the due date.
    IF NOT v_manager THEN NEW.assigned_to := NULL; NEW.due_on := NULL; END IF;
  ELSIF NOT v_manager AND (
    NEW.branch_id <> OLD.branch_id OR NEW.title IS DISTINCT FROM OLD.title OR NEW.category IS DISTINCT FROM OLD.category
    OR NEW.details IS DISTINCT FROM OLD.details OR NEW.priority IS DISTINCT FROM OLD.priority
    OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.due_on IS DISTINCT FROM OLD.due_on
    OR NEW.photo_attachment_id IS DISTINCT FROM OLD.photo_attachment_id
  ) THEN
    -- The person it is assigned to only moves it on (in progress, done, with a note).
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF NEW.assigned_to IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
     AND NOT EXISTS (SELECT 1 FROM app_alert_people(NEW.branch_id, enum_range(NULL::app_role)) p WHERE p = NEW.assigned_to) THEN
    RAISE EXCEPTION 'assignee_not_in_branch' USING ERRCODE = '23514';
  END IF;
  IF NEW.photo_attachment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM attachment WHERE id = NEW.photo_attachment_id AND branch_id = NEW.branch_id) THEN
    RAISE EXCEPTION 'file not in branch' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'resolved' AND (TG_OP = 'INSERT' OR OLD.status <> 'resolved') THEN
    NEW.resolved_at := now();
    NEW.resolved_by := app_current_user_id();
  ELSIF NEW.status <> 'resolved' THEN
    NEW.resolved_at := NULL;
    NEW.resolved_by := NULL;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER issue_before BEFORE INSERT OR UPDATE ON issue FOR EACH ROW EXECUTE FUNCTION app_issue_before();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_issue_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to IS DISTINCT FROM app_current_user_id()
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    PERFORM app_raise_alert(NEW.branch_id, 'issue_assigned', 'info', 'issue', NEW.id, format('issue:%s:%s', NEW.id, NEW.assigned_to),
      ARRAY[NEW.assigned_to], NEW.is_demo);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER issue_after AFTER INSERT OR UPDATE OF assigned_to ON issue FOR EACH ROW EXECUTE FUNCTION app_issue_after();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit (rule 7), row-level security and privileges
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incident', 'incident_person', 'incident_action', 'incident_file', 'issue', 'alert'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t || '_audit', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_columns()', t || '_set_updated', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['incident', 'incident_person', 'incident_action', 'incident_file', 'issue', 'alert',
                           'notification', 'notification_delivery', 'push_subscription'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- The report's own fields only; status, review and closure go through the functions above.
GRANT SELECT, INSERT ON incident TO yanmu_app;
--> statement-breakpoint
GRANT UPDATE (room_id, occurred_at, category, severity, description, immediate_action, guardian_notified_at,
              guardian_notification_note, report_details) ON incident TO yanmu_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON incident_person, incident_file TO yanmu_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON incident_action TO yanmu_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON issue TO yanmu_app;
--> statement-breakpoint
GRANT SELECT ON alert TO yanmu_app;
--> statement-breakpoint
GRANT SELECT ON notification TO yanmu_app;
--> statement-breakpoint
GRANT UPDATE (read_at) ON notification TO yanmu_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON push_subscription TO yanmu_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_ack_alert(uuid), app_run_alerts(), app_claim_deliveries(integer), app_delivery_done(uuid, text, text, text[]),
  app_incident_seen(uuid), app_incident_submit_report(uuid), app_incident_review(uuid, text), app_incident_close(uuid, text),
  app_incident_action_done(uuid), app_branch_people(uuid) TO yanmu_app;
--> statement-breakpoint

CREATE POLICY incident_read ON incident FOR SELECT TO yanmu_app
  USING (app_safety_viewer(branch_id) OR created_by = app_current_user_id());
--> statement-breakpoint
-- Teachers report for their own classes; front desk and managers for the branch (spec §5).
CREATE POLICY incident_insert ON incident FOR INSERT TO yanmu_app
  WITH CHECK (
    app_has_role_in(branch_id, ARRAY['front_desk', 'branch_manager', 'company_manager']::app_role[])
    OR (app_has_role_in(branch_id, ARRAY['teacher']::app_role[]) AND room_id = ANY (app_teacher_room_ids()))
  );
--> statement-breakpoint
CREATE POLICY incident_update ON incident FOR UPDATE TO yanmu_app
  USING (status <> 'closed' AND (app_incident_manager(branch_id) OR created_by = app_current_user_id()))
  WITH CHECK (app_incident_manager(branch_id) OR created_by = app_current_user_id());
--> statement-breakpoint

CREATE POLICY incident_person_read ON incident_person FOR SELECT TO yanmu_app USING (app_incident_visible(incident_id));
--> statement-breakpoint
-- A child can be added only if the person can see that child.
CREATE POLICY incident_person_insert ON incident_person FOR INSERT TO yanmu_app
  WITH CHECK (app_incident_editable(incident_id) AND (student_id IS NULL OR EXISTS (SELECT 1 FROM student s WHERE s.id = student_id)));
--> statement-breakpoint
CREATE POLICY incident_person_delete ON incident_person FOR DELETE TO yanmu_app USING (app_incident_editable(incident_id));
--> statement-breakpoint

CREATE POLICY incident_action_read ON incident_action FOR SELECT TO yanmu_app
  USING (app_incident_visible(incident_id) OR owner_user_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY incident_action_insert ON incident_action FOR INSERT TO yanmu_app
  WITH CHECK (app_incident_manager(branch_id) AND app_incident_editable(incident_id));
--> statement-breakpoint

CREATE POLICY incident_file_read ON incident_file FOR SELECT TO yanmu_app USING (app_incident_visible(incident_id));
--> statement-breakpoint
CREATE POLICY incident_file_insert ON incident_file FOR INSERT TO yanmu_app WITH CHECK (app_incident_editable(incident_id));
--> statement-breakpoint
CREATE POLICY incident_file_delete ON incident_file FOR DELETE TO yanmu_app USING (app_incident_editable(incident_id));
--> statement-breakpoint

CREATE POLICY issue_read ON issue FOR SELECT TO yanmu_app
  USING (app_safety_viewer(branch_id) OR created_by = app_current_user_id() OR assigned_to = app_current_user_id());
--> statement-breakpoint
CREATE POLICY issue_insert ON issue FOR INSERT TO yanmu_app WITH CHECK (app_safety_reporter(branch_id));
--> statement-breakpoint
CREATE POLICY issue_update ON issue FOR UPDATE TO yanmu_app
  USING (app_incident_manager(branch_id) OR assigned_to = app_current_user_id())
  WITH CHECK (app_incident_manager(branch_id) OR assigned_to = app_current_user_id());
--> statement-breakpoint

CREATE POLICY alert_read ON alert FOR SELECT TO yanmu_app
  USING (
    EXISTS (SELECT 1 FROM notification n WHERE n.alert_id = alert.id AND n.user_id = app_current_user_id())
    OR app_has_role_in(branch_id, ARRAY['owner', 'company_manager']::app_role[])
  );
--> statement-breakpoint
CREATE POLICY notification_read ON notification FOR SELECT TO yanmu_app USING (user_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY notification_update ON notification FOR UPDATE TO yanmu_app
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY push_subscription_own ON push_subscription FOR ALL TO yanmu_app
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint

-- Photos of incidents and issues: the people who may report upload them; whoever sees the incident
-- or issue reads them.
CREATE POLICY attachment_insert_safety ON attachment FOR INSERT TO yanmu_app WITH CHECK (app_safety_reporter(branch_id));
--> statement-breakpoint
CREATE POLICY attachment_read_safety ON attachment FOR SELECT TO yanmu_app
  USING (
    (created_by = app_current_user_id() AND app_safety_reporter(branch_id))
    OR EXISTS (SELECT 1 FROM incident_file f WHERE f.attachment_id = attachment.id)
    OR EXISTS (SELECT 1 FROM issue i WHERE i.photo_attachment_id = attachment.id)
  );
--> statement-breakpoint

-- Audit log: none of these tables are finance, so only the owner and company manager read their rows.
-- Settings added in this phase.
INSERT INTO setting (org_id, branch_id, key, value)
SELECT o.id, NULL, 'alerts.critical_repeat_minutes', '5'::jsonb FROM organization o
WHERE NOT EXISTS (SELECT 1 FROM setting s WHERE s.org_id = o.id AND s.branch_id IS NULL AND s.key = 'alerts.critical_repeat_minutes');
