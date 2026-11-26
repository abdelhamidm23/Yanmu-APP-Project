-- Phase 6: closing (spec §6.1, §6.2, §8.9, §8.10, §9).
--   daily close  = the branch manager (or company manager) confirms the day once; a closed day stays closed.
--                  Owner, company manager, branch manager and accountant see the closes.
--   month close  = the accountant uploads the month-close template, explains every difference and closes
--                  the month; its figures become Verified and money dated in it can no longer be posted.
--                  Reopening is asked by the accountant and decided by the owner (never the person who asked).
--   figures      = app_kpis(): every figure from the source tables with its data status; money figures
--                  only for the owner, company manager and accountant. Snapshots are kept every night.

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_day_closer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['branch_manager', 'company_manager']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_close_viewer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['owner', 'company_manager', 'branch_manager', 'accountant']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_period_viewer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['owner', 'company_manager', 'accountant']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_period_closer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['accountant']::app_role[])
$$;
--> statement-breakpoint

-- Is the month of this date closed for the branch?
CREATE OR REPLACE FUNCTION app_month_closed(p_branch uuid, p_date date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM period_close WHERE branch_id = p_branch AND month = date_trunc('month', p_date)::date AND status = 'closed'
  )
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Daily close (spec §8.9)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_daily_close_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
  v_state text;
  v_due time := coalesce(app_setting(NEW.branch_id, 'daily_close.due_time') #>> '{}', '19:00')::time;
BEGIN
  IF NEW.date > app_cairo_today() THEN RAISE EXCEPTION 'invalid date' USING ERRCODE = '23514'; END IF;
  IF jsonb_typeof(NEW.sections) <> 'object' THEN RAISE EXCEPTION 'invalid' USING ERRCODE = '23514'; END IF;
  FOREACH v_key IN ARRAY ARRAY['attendance', 'pickups', 'staff', 'payments', 'expenses', 'incidents', 'issues'] LOOP
    v_state := NEW.sections -> v_key ->> 'state';
    IF v_state IS NULL OR v_state NOT IN ('correct', 'fix', 'none') THEN
      RAISE EXCEPTION 'section_missing' USING ERRCODE = '23514';
    END IF;
    -- "To fix" needs a word on what is wrong (spec §8.9 step 2).
    IF v_state = 'fix' AND length(btrim(coalesce(NEW.sections -> v_key ->> 'note', ''))) < 3 THEN
      RAISE EXCEPTION 'fix_note_required' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF NOT app_is_system() THEN
    NEW.closed_by := app_current_user_id();
    NEW.closed_at := now();
  END IF;
  NEW.is_late := NEW.closed_at > ((NEW.date + v_due)::timestamp AT TIME ZONE 'Africa/Cairo');
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER daily_close_before BEFORE INSERT ON daily_close FOR EACH ROW EXECUTE FUNCTION app_daily_close_before();
--> statement-breakpoint

-- Closing the day stops its prompt and its "not closed" alert.
CREATE OR REPLACE FUNCTION app_daily_close_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE alert SET resolved_at = now()
  WHERE resolved_at IS NULL AND branch_id = NEW.branch_id AND key IN ('daily_close_prompt', 'daily_close_missing')
    AND dedupe_key IN (format('close_prompt:%s:%s', NEW.branch_id, NEW.date), format('close_missing:%s:%s', NEW.branch_id, NEW.date));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER daily_close_after AFTER INSERT ON daily_close FOR EACH ROW EXECUTE FUNCTION app_daily_close_after();
--> statement-breakpoint

-- The time-of-day alerts (replaces Phase 5's): children still in after hours; at the prompt time the
-- branch manager is asked to close the day; at the alert time a day still not closed goes to the
-- company manager (spec §8.9 steps 1 and 4).
CREATE OR REPLACE FUNCTION app_time_alerts() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b record;
  v_today date := app_cairo_today();
  v_now time := (now() AT TIME ZONE 'Africa/Cairo')::time;
  v_until time;
  v_closed boolean;
BEGIN
  FOR v_b IN SELECT id, is_active FROM branch WHERE is_active LOOP
    CONTINUE WHEN NOT is_working_day(v_b.id, v_today);
    v_until := coalesce(app_setting(v_b.id, 'attendance.closing_time') #>> '{}', '16:00')::time
             + make_interval(mins => coalesce(app_setting_bigint(v_b.id, 'attendance.after_school_minutes', 60), 60)::integer);
    IF v_now >= v_until AND EXISTS (
      SELECT 1 FROM student_attendance WHERE branch_id = v_b.id AND date = v_today AND status = 'present' AND check_out_at IS NULL
    ) THEN
      PERFORM app_raise_alert(v_b.id, 'still_checked_in', 'same_day', 'branch', v_b.id, format('still_in:%s:%s', v_b.id, v_today));
    END IF;

    v_closed := EXISTS (SELECT 1 FROM daily_close WHERE branch_id = v_b.id AND date = v_today);
    CONTINUE WHEN v_closed;
    IF v_now >= coalesce(app_setting(v_b.id, 'daily_close.prompt_time') #>> '{}', '17:00')::time THEN
      PERFORM app_raise_alert(v_b.id, 'daily_close_prompt', 'info', 'branch', v_b.id, format('close_prompt:%s:%s', v_b.id, v_today));
    END IF;
    IF v_now >= coalesce(app_setting(v_b.id, 'daily_close.alert_time') #>> '{}', '21:00')::time THEN
      PERFORM app_raise_alert(v_b.id, 'daily_close_missing', 'same_day', 'branch', v_b.id, format('close_missing:%s:%s', v_b.id, v_today));
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Month close (spec §8.10)
-- ---------------------------------------------------------------------------

-- The period row of a branch and month, made when first needed (accountant or the system).
CREATE OR REPLACE FUNCTION app_period(p_branch uuid, p_month date) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_month date := date_trunc('month', p_month)::date;
BEGIN
  IF NOT (app_period_viewer(p_branch) OR app_is_system()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_id FROM period_close WHERE branch_id = p_branch AND month = v_month;
  IF v_id IS NULL THEN
    INSERT INTO period_close (branch_id, month) VALUES (p_branch, v_month)
    ON CONFLICT (branch_id, month) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN SELECT id INTO v_id FROM period_close WHERE branch_id = p_branch AND month = v_month; END IF;
  END IF;
  RETURN v_id;
END
$$;
--> statement-breakpoint

-- Closes a finished month: the template is uploaded and every difference is explained.
CREATE OR REPLACE FUNCTION app_close_period(p_period uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p period_close%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM period_close WHERE id = p_period FOR UPDATE;
  IF v_p.id IS NULL OR NOT (app_period_closer(v_p.branch_id) OR app_is_system()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF v_p.status = 'closed' THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514'; END IF;
  IF v_p.month >= date_trunc('month', app_cairo_today())::date THEN RAISE EXCEPTION 'month_not_over' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM period_import_line WHERE period_close_id = p_period) THEN
    RAISE EXCEPTION 'template_required' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM period_import_line WHERE period_close_id = p_period AND kind = 'check'
      AND app_piastres IS DISTINCT FROM amount_piastres AND length(btrim(coalesce(note, ''))) < 3
  ) THEN
    RAISE EXCEPTION 'difference_note_required' USING ERRCODE = '23514';
  END IF;
  UPDATE period_close SET status = 'closed', closed_at = now(), closed_by = app_current_user_id(),
    reopen_requested_by = NULL, reopen_requested_at = NULL, reopen_reason = NULL
  WHERE id = p_period;
END
$$;
--> statement-breakpoint

-- The accountant asks to reopen a closed month, with a reason.
CREATE OR REPLACE FUNCTION app_request_period_reopen(p_period uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p period_close%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM period_close WHERE id = p_period FOR UPDATE;
  IF v_p.id IS NULL OR NOT app_period_closer(v_p.branch_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF v_p.status <> 'closed' OR v_p.reopen_requested_at IS NOT NULL THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '23514'; END IF;
  UPDATE period_close SET reopen_requested_by = app_current_user_id(), reopen_requested_at = now(), reopen_reason = btrim(p_reason)
  WHERE id = p_period;
END
$$;
--> statement-breakpoint

-- The owner decides. Nobody decides their own request.
CREATE OR REPLACE FUNCTION app_decide_period_reopen(p_period uuid, p_approve boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p period_close%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM period_close WHERE id = p_period FOR UPDATE;
  IF v_p.id IS NULL OR NOT app_has_role_in(v_p.branch_id, ARRAY['owner']::app_role[]) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF v_p.reopen_requested_at IS NULL OR v_p.status <> 'closed' THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514'; END IF;
  IF v_p.reopen_requested_by = app_current_user_id() THEN RAISE EXCEPTION 'own_request' USING ERRCODE = '42501'; END IF;
  IF p_approve THEN
    UPDATE period_close SET status = 'open', reopened_by = app_current_user_id(), reopened_at = now(),
      closed_at = NULL, closed_by = NULL, reopen_requested_at = NULL, reopen_requested_by = NULL
    WHERE id = p_period;
  ELSE
    UPDATE period_close SET reopen_requested_at = NULL, reopen_requested_by = NULL WHERE id = p_period;
  END IF;
END
$$;
--> statement-breakpoint

-- Lines and balances change only while their month is open, and only by the accountant.
CREATE OR REPLACE FUNCTION app_period_line_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_p period_close%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'period_import_line' THEN
    SELECT * INTO v_p FROM period_close WHERE id = v_row.period_close_id;
    IF TG_OP = 'INSERT' THEN NEW.branch_id := v_p.branch_id; END IF;
  ELSE
    SELECT * INTO v_p FROM period_close WHERE branch_id = v_row.branch_id AND month = v_row.month;
  END IF;
  IF v_p.status = 'closed' THEN RAISE EXCEPTION 'month_closed' USING ERRCODE = '23514'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
--> statement-breakpoint
CREATE TRIGGER period_import_line_guard BEFORE INSERT OR UPDATE OR DELETE ON period_import_line FOR EACH ROW EXECUTE FUNCTION app_period_line_guard();
--> statement-breakpoint
CREATE TRIGGER balance_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON balance_snapshot FOR EACH ROW EXECUTE FUNCTION app_period_line_guard();
--> statement-breakpoint

-- A closed month is locked (spec §8.10): no invoice, payment, void or expense dated in it.
CREATE OR REPLACE FUNCTION app_period_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'invoice' THEN
    -- A late-fee invoice belongs to the month it is issued in (its tuition month may be closed already).
    IF (NEW.kind <> 'late_fee' AND app_month_closed(NEW.branch_id, NEW.service_month)) OR app_month_closed(NEW.branch_id, NEW.issue_date) THEN
      RAISE EXCEPTION 'month_closed' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'payment' THEN
    IF (TG_OP = 'INSERT' OR NEW.voided_at IS DISTINCT FROM OLD.voided_at)
       AND app_month_closed(NEW.branch_id, (NEW.received_at AT TIME ZONE 'Africa/Cairo')::date) THEN
      RAISE EXCEPTION 'month_closed' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'expense' THEN
    IF NEW.spent_on IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.spent_on IS DISTINCT FROM OLD.spent_on)
       AND app_month_closed(NEW.branch_id, NEW.spent_on)
       -- Reversing an expense of a closed month is booked in the open month, so only the original is touched.
       AND NOT (TG_OP = 'UPDATE' AND NEW.status = 'reversed') THEN
      RAISE EXCEPTION 'month_closed' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_period_lock BEFORE INSERT ON invoice FOR EACH ROW EXECUTE FUNCTION app_period_lock();
--> statement-breakpoint
CREATE TRIGGER payment_period_lock BEFORE INSERT OR UPDATE OF voided_at ON payment FOR EACH ROW EXECUTE FUNCTION app_period_lock();
--> statement-breakpoint
CREATE TRIGGER expense_period_lock BEFORE INSERT OR UPDATE OF status, spent_on ON expense FOR EACH ROW EXECUTE FUNCTION app_period_lock();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Figures with their data status (spec §6.1, §9)
-- ---------------------------------------------------------------------------
-- One row per figure for a branch on a date (month figures are for the month of that date, up to it).
-- num / den let "All branches" add parts up; status is verified | provisional | incomplete |
-- not_submitted | confirmed; done / total give the coverage ("11 of 12 classes").
-- Money figures only for the owner, company manager and accountant (and the nightly job).

CREATE OR REPLACE FUNCTION app_kpis(p_branch uuid, p_date date)
RETURNS TABLE (key text, value numeric, num numeric, den numeric, status text, done integer, total integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- The nightly job (owner connection, no person); never an app connection that forgot its user.
  v_job boolean := app_is_system();
  v_money boolean;
  v_month date := date_trunc('month', p_date)::date;
  v_next date := (date_trunc('month', p_date) + interval '1 month')::date;
  v_day_start timestamptz := p_date::timestamp AT TIME ZONE 'Africa/Cairo';
  v_day_end timestamptz := (p_date + 1)::timestamp AT TIME ZONE 'Africa/Cairo';
  v_month_start timestamptz := v_month::timestamp AT TIME ZONE 'Africa/Cairo';
  v_closed_day boolean;
  v_close jsonb;
  v_month_closed boolean;
  v_working boolean := is_working_day(p_branch, p_date);
  v_active integer;
  v_licensed integer;
  v_rooms integer;
  v_rooms_done integer;
  v_present integer;
  v_expected integer;
  v_staff_rows integer;
  v_staff_present integer;
  v_staff_total integer;
  v_breaches integer;
  v_incidents_day integer;
  v_incidents_month integer;
  v_days integer;
  v_days_closed integer;
  v_salaries boolean;
  v_billed bigint;
  v_expenses bigint;
  v_central bigint;
  v_money_status text;
  v_result_status text;
BEGIN
  IF NOT (v_job OR app_close_viewer(p_branch)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  v_money := v_job OR app_period_viewer(p_branch);

  SELECT d.sections INTO v_close FROM daily_close d WHERE d.branch_id = p_branch AND d.date = p_date;
  v_closed_day := v_close IS NOT NULL;
  v_month_closed := app_month_closed(p_branch, p_date);

  -- Children (spec §9.2)
  SELECT count(*) INTO v_active FROM enrollment e
  WHERE e.branch_id = p_branch AND e.start_date <= p_date AND (e.end_date IS NULL OR e.end_date >= p_date)
    AND e.status IN ('active', 'withdrawn', 'transferred', 'graduated');
  SELECT coalesce(b.licensed_capacity, 0) INTO v_licensed FROM branch b WHERE b.id = p_branch;
  key := 'children.active'; value := v_active; num := v_active; den := NULL; status := 'provisional'; done := NULL; total := NULL; RETURN NEXT;
  key := 'children.occupancy'; num := v_active; den := nullif(v_licensed, 0);
  value := CASE WHEN v_licensed > 0 THEN round(100.0 * v_active / v_licensed, 1) END; RETURN NEXT;

  -- Attendance on the day: present ÷ (present + absent); classes with every child marked.
  WITH r AS (
    SELECT e.room_id, count(*) AS kids, count(sa.id) AS marked,
           count(*) FILTER (WHERE sa.status = 'present') AS present,
           count(*) FILTER (WHERE sa.status IN ('present', 'absent')) AS expected
    FROM enrollment e
    LEFT JOIN student_attendance sa ON sa.student_id = e.student_id AND sa.date = p_date
    WHERE e.branch_id = p_branch AND e.start_date <= p_date AND (e.end_date IS NULL OR e.end_date >= p_date)
      AND e.status IN ('active', 'withdrawn', 'transferred', 'graduated')
    GROUP BY e.room_id
  )
  SELECT count(*), count(*) FILTER (WHERE marked >= kids), coalesce(sum(present), 0), coalesce(sum(expected), 0)
  INTO v_rooms, v_rooms_done, v_present, v_expected FROM r;
  key := 'attendance.day'; num := v_present; den := v_expected; done := v_rooms_done; total := v_rooms;
  value := CASE WHEN v_expected > 0 THEN round(100.0 * v_present / v_expected, 1) END;
  status := CASE WHEN NOT v_working THEN 'confirmed' WHEN v_rooms_done = 0 THEN 'not_submitted'
                 WHEN v_rooms_done < v_rooms THEN 'incomplete' ELSE 'provisional' END;
  RETURN NEXT;

  -- Team (spec §9.3): staff present from the fingerprint file; ratio breaches from the snapshots.
  SELECT count(*), count(*) FILTER (WHERE d.status IN ('present', 'late')) INTO v_staff_rows, v_staff_present
  FROM staff_attendance_day d WHERE d.branch_id = p_branch AND d.date = p_date;
  SELECT count(*) INTO v_staff_total FROM staff s WHERE s.branch_id = p_branch AND s.status = 'active';
  key := 'staff.present'; value := v_staff_present; num := v_staff_present; den := v_staff_total; done := NULL; total := NULL;
  status := CASE WHEN NOT v_working THEN 'confirmed' WHEN v_staff_rows = 0 THEN 'not_submitted' ELSE 'provisional' END;
  IF v_staff_rows = 0 AND v_working THEN value := NULL; num := NULL; END IF;
  RETURN NEXT;
  SELECT count(DISTINCT rs.room_id) INTO v_breaches FROM ratio_snapshot rs
  WHERE rs.branch_id = p_branch AND rs.is_breach AND rs.taken_at >= v_day_start AND rs.taken_at < v_day_end;
  key := 'ratio.breaches'; value := v_breaches; num := v_breaches; den := NULL; done := v_rooms_done; total := v_rooms;
  status := CASE WHEN NOT v_working THEN 'confirmed' WHEN v_rooms_done = 0 THEN 'not_submitted'
                 WHEN v_breaches = 0 AND v_closed_day THEN 'confirmed' WHEN v_closed_day THEN 'provisional' ELSE 'incomplete' END;
  RETURN NEXT;

  -- Safety (spec §9.4)
  SELECT count(*) INTO v_incidents_day FROM incident i WHERE i.branch_id = p_branch AND i.occurred_at >= v_day_start AND i.occurred_at < v_day_end;
  key := 'incidents.day'; value := v_incidents_day; num := v_incidents_day; den := NULL; done := NULL; total := NULL;
  -- A zero counts only once the day is closed with "Yes, none" (spec §6.2).
  status := CASE WHEN v_incidents_day > 0 THEN 'provisional'
                 WHEN v_close -> 'incidents' ->> 'state' = 'none' THEN 'confirmed'
                 WHEN NOT v_working THEN 'confirmed' ELSE 'incomplete' END;
  RETURN NEXT;
  SELECT count(*) INTO v_incidents_month FROM incident i WHERE i.branch_id = p_branch AND i.occurred_at >= v_month_start AND i.occurred_at < v_day_end;
  key := 'incidents.month'; value := v_incidents_month; num := v_incidents_month; den := NULL; status := 'provisional'; RETURN NEXT;
  key := 'incidents.rate'; num := v_incidents_month; den := v_active;
  value := CASE WHEN v_active > 0 THEN round(100.0 * v_incidents_month / v_active, 1) END; RETURN NEXT;
  key := 'incidents.open_critical';
  SELECT count(*) INTO value FROM incident i WHERE i.branch_id = p_branch AND i.severity = 'critical' AND i.status <> 'closed';
  num := value; den := NULL; status := CASE WHEN value = 0 THEN 'confirmed' ELSE 'provisional' END; RETURN NEXT;
  key := 'actions.overdue';
  SELECT (SELECT count(*) FROM incident_action x WHERE x.branch_id = p_branch AND x.done_at IS NULL AND x.due_on < p_date)
       + (SELECT count(*) FROM issue s WHERE s.branch_id = p_branch AND s.status <> 'resolved' AND s.due_on < p_date)
  INTO value;
  num := value; status := 'provisional'; RETURN NEXT;

  -- Daily close rate: working days of the month up to the date (the date itself once it is closed).
  SELECT count(*) FILTER (WHERE is_working_day(p_branch, d::date) AND (d::date < p_date OR (d::date = p_date AND v_closed_day))),
         count(*) FILTER (WHERE is_working_day(p_branch, d::date) AND d::date < p_date AND EXISTS (
           SELECT 1 FROM daily_close c WHERE c.branch_id = p_branch AND c.date = d::date)) + CASE WHEN v_closed_day THEN 1 ELSE 0 END
  INTO v_days, v_days_closed
  FROM generate_series(v_month, p_date, interval '1 day') d;
  key := 'close.rate'; num := v_days_closed; den := v_days; done := v_days_closed; total := v_days;
  value := CASE WHEN v_days > 0 THEN round(100.0 * v_days_closed / v_days, 1) END;
  status := CASE WHEN v_days = 0 THEN 'not_submitted' WHEN v_days_closed < v_days THEN 'incomplete' ELSE 'provisional' END;
  RETURN NEXT;
  key := 'close.day'; value := CASE WHEN v_closed_day THEN 1 ELSE 0 END; num := value; den := NULL; done := NULL; total := NULL;
  status := CASE WHEN v_closed_day THEN 'confirmed' WHEN NOT v_working THEN 'confirmed' ELSE 'not_submitted' END;
  RETURN NEXT;

  IF NOT v_money THEN RETURN; END IF;

  -- Money (spec §9.1). Verified once the month is closed; otherwise Provisional.
  v_money_status := CASE WHEN v_month_closed THEN 'verified' ELSE 'provisional' END;
  SELECT coalesce(sum(i.total_piastres - i.credited_piastres), 0) INTO v_billed FROM invoice i
  WHERE i.branch_id = p_branch AND i.service_month = v_month AND i.kind <> 'late_fee' AND i.status <> 'void';
  key := 'money.billed'; value := v_billed; num := v_billed; den := NULL; status := v_money_status; RETURN NEXT;
  key := 'money.collected';
  SELECT coalesce(sum(p.amount_piastres), 0) INTO value FROM payment p
  WHERE p.branch_id = p_branch AND p.voided_at IS NULL AND p.received_at >= v_month_start AND p.received_at < v_day_end;
  num := value; RETURN NEXT;
  key := 'money.collected_day';
  SELECT coalesce(sum(p.amount_piastres), 0) INTO value FROM payment p
  WHERE p.branch_id = p_branch AND p.voided_at IS NULL AND p.received_at >= v_day_start AND p.received_at < v_day_end;
  num := value; status := CASE WHEN v_month_closed THEN 'verified' WHEN value = 0 AND v_close -> 'payments' ->> 'state' = 'none' THEN 'confirmed'
                               WHEN value = 0 AND NOT v_closed_day AND v_working THEN 'incomplete' ELSE 'provisional' END;
  RETURN NEXT;
  status := v_money_status;
  -- Collection rate, month: tuition paid on invoices due by the date ÷ tuition due by the date.
  key := 'money.collection_rate';
  SELECT coalesce(sum(i.paid_piastres), 0), coalesce(sum(i.total_piastres - i.credited_piastres), 0) INTO num, den FROM invoice i
  WHERE i.branch_id = p_branch AND i.kind = 'tuition' AND i.status <> 'void' AND i.service_month = v_month AND i.due_date <= p_date;
  value := CASE WHEN den > 0 THEN round(100.0 * num / den, 1) END; RETURN NEXT;
  key := 'money.overdue';
  SELECT coalesce(sum(i.total_piastres - i.paid_piastres - i.credited_piastres), 0), count(DISTINCT i.family_id) INTO num, den FROM invoice i
  WHERE i.branch_id = p_branch AND i.kind <> 'late_fee' AND i.status NOT IN ('paid', 'void') AND i.due_date < p_date
    AND i.total_piastres - i.paid_piastres - i.credited_piastres > 0;
  value := num; status := 'provisional'; RETURN NEXT;
  key := 'money.late_fees_outstanding';
  SELECT coalesce(sum(i.total_piastres - i.paid_piastres - i.credited_piastres), 0) INTO value FROM invoice i
  WHERE i.branch_id = p_branch AND i.kind = 'late_fee' AND i.status NOT IN ('paid', 'void');
  num := value; den := NULL; RETURN NEXT;

  -- Operating expenses: the app's expenses of the month + the accountant's central lines (salaries, rent …).
  SELECT coalesce(sum(e.amount_piastres), 0) INTO v_expenses FROM expense e
  WHERE e.branch_id = p_branch AND NOT e.is_request AND e.status IN ('recorded', 'approved', 'reversed')
    AND e.spent_on >= v_month AND e.spent_on < v_next AND e.spent_on <= p_date;
  SELECT coalesce(sum(l.amount_piastres), 0), bool_or(l.line_key = 'central:salaries')
  INTO v_central, v_salaries
  FROM period_import_line l JOIN period_close pc ON pc.id = l.period_close_id
  WHERE pc.branch_id = p_branch AND pc.month = v_month AND l.kind = 'central';
  -- Until payroll is in, costs and the result are Incomplete (spec §9.1).
  v_result_status := CASE WHEN v_month_closed THEN 'verified' WHEN coalesce(v_salaries, false) THEN 'provisional' ELSE 'incomplete' END;
  key := 'money.expenses'; value := v_expenses + v_central; num := value; den := NULL; status := v_result_status; RETURN NEXT;
  key := 'money.result'; value := v_billed - v_expenses - v_central; num := value; RETURN NEXT;
END
$$;
--> statement-breakpoint

-- The nightly snapshot of every branch's figures for a date (job only).
CREATE OR REPLACE FUNCTION app_snapshot_kpis(p_date date) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n integer := 0;
  v_b record;
  v_count integer;
BEGIN
  IF NOT app_is_system() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  FOR v_b IN SELECT id FROM branch WHERE is_active LOOP
    INSERT INTO kpi_daily_snapshot (branch_id, date, kpi_key, value, status, coverage)
    SELECT v_b.id, p_date, k.key, k.value, k.status, CASE WHEN k.total IS NOT NULL THEN format('%s/%s', k.done, k.total) END
    FROM app_kpis(v_b.id, p_date) k
    ON CONFLICT (branch_id, date, kpi_key) DO UPDATE
      SET value = EXCLUDED.value, status = EXCLUDED.status, coverage = EXCLUDED.coverage, taken_at = now();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_n := v_n + v_count;
  END LOOP;
  RETURN v_n;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit (rule 7), row-level security and privileges
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['daily_close', 'period_close', 'period_import_line', 'balance_snapshot'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t || '_audit', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_columns()', t || '_set_updated', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['daily_close', 'period_close', 'period_import_line', 'balance_snapshot', 'kpi_daily_snapshot'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
--> statement-breakpoint

GRANT SELECT, INSERT ON daily_close TO yanmu_app;
--> statement-breakpoint
GRANT SELECT ON period_close, kpi_daily_snapshot TO yanmu_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON period_import_line, balance_snapshot TO yanmu_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_period(uuid, date), app_close_period(uuid), app_request_period_reopen(uuid, text),
  app_decide_period_reopen(uuid, boolean), app_kpis(uuid, date), app_snapshot_kpis(date), app_month_closed(uuid, date) TO yanmu_app;
--> statement-breakpoint

CREATE POLICY daily_close_read ON daily_close FOR SELECT TO yanmu_app USING (app_close_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY daily_close_insert ON daily_close FOR INSERT TO yanmu_app WITH CHECK (app_day_closer(branch_id) AND NOT is_demo);
--> statement-breakpoint
CREATE POLICY period_close_read ON period_close FOR SELECT TO yanmu_app USING (app_period_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY period_import_line_read ON period_import_line FOR SELECT TO yanmu_app USING (app_period_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY period_import_line_insert ON period_import_line FOR INSERT TO yanmu_app
  WITH CHECK (app_period_closer(branch_id) AND EXISTS (SELECT 1 FROM period_close p WHERE p.id = period_close_id AND p.branch_id = period_import_line.branch_id));
--> statement-breakpoint
CREATE POLICY period_import_line_delete ON period_import_line FOR DELETE TO yanmu_app USING (app_period_closer(branch_id));
--> statement-breakpoint
CREATE POLICY balance_snapshot_read ON balance_snapshot FOR SELECT TO yanmu_app USING (app_period_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY balance_snapshot_insert ON balance_snapshot FOR INSERT TO yanmu_app WITH CHECK (app_period_closer(branch_id));
--> statement-breakpoint
CREATE POLICY balance_snapshot_delete ON balance_snapshot FOR DELETE TO yanmu_app USING (app_period_closer(branch_id));
--> statement-breakpoint
-- Money figures stay with the owner, company manager and accountant.
CREATE POLICY kpi_snapshot_read ON kpi_daily_snapshot FOR SELECT TO yanmu_app
  USING (app_period_viewer(branch_id) OR (kpi_key NOT LIKE 'money.%' AND app_close_viewer(branch_id)));
--> statement-breakpoint

-- Month-close uploads are import batches of kind 'month_close' (added to the Phase 3 policies).
CREATE POLICY import_batch_month_close_read ON import_batch FOR SELECT TO yanmu_app
  USING (kind = 'month_close' AND app_period_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY import_batch_month_close_insert ON import_batch FOR INSERT TO yanmu_app
  WITH CHECK (kind = 'month_close' AND app_period_closer(branch_id));
--> statement-breakpoint
CREATE POLICY import_batch_month_close_update ON import_batch FOR UPDATE TO yanmu_app
  USING (kind = 'month_close' AND app_period_closer(branch_id))
  WITH CHECK (kind = 'month_close' AND app_period_closer(branch_id));
--> statement-breakpoint

-- What the daily close shows for each section (spec §8.9 step 1), as counts only: no amounts and no
-- names, so the branch manager can confirm payments and cash without seeing money (owner, 2026-11-23).
CREATE OR REPLACE FUNCTION app_day_facts(p_branch uuid, p_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start timestamptz := p_date::timestamp AT TIME ZONE 'Africa/Cairo';
  v_end timestamptz := (p_date + 1)::timestamp AT TIME ZONE 'Africa/Cairo';
  v jsonb;
BEGIN
  IF NOT (app_close_viewer(p_branch) OR app_is_system()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  WITH r AS (
    SELECT e.room_id, count(*) AS kids, count(sa.id) AS marked,
           count(*) FILTER (WHERE sa.status = 'present') AS present,
           count(*) FILTER (WHERE sa.status = 'absent') AS absent,
           count(*) FILTER (WHERE sa.status = 'excused') AS excused,
           count(*) FILTER (WHERE sa.status = 'present' AND sa.check_out_at IS NOT NULL) AS out,
           count(*) FILTER (WHERE sa.status = 'present' AND sa.check_out_at IS NULL) AS still_in
    FROM enrollment e
    LEFT JOIN student_attendance sa ON sa.student_id = e.student_id AND sa.date = p_date
    WHERE e.branch_id = p_branch AND e.start_date <= p_date AND (e.end_date IS NULL OR e.end_date >= p_date)
      AND e.status IN ('active', 'withdrawn', 'transferred', 'graduated')
    GROUP BY e.room_id
  )
  SELECT jsonb_build_object(
    'attendance', jsonb_build_object(
      'classes', count(*), 'classesDone', count(*) FILTER (WHERE marked >= kids),
      'present', coalesce(sum(present), 0), 'absent', coalesce(sum(absent), 0), 'excused', coalesce(sum(excused), 0),
      'notMarked', coalesce(sum(kids - marked), 0)),
    'pickups', jsonb_build_object(
      'checkedOut', coalesce(sum(out), 0), 'stillIn', coalesce(sum(still_in), 0),
      'refusals', (SELECT count(*) FROM pickup_refusal p WHERE p.branch_id = p_branch AND p.happened_at >= v_start AND p.happened_at < v_end)))
  INTO v FROM r;
  RETURN v || jsonb_build_object(
    'staff', (SELECT jsonb_build_object(
        'uploaded', count(*) > 0,
        'present', count(*) FILTER (WHERE d.status = 'present'),
        'late', count(*) FILTER (WHERE d.status = 'late'),
        'absent', count(*) FILTER (WHERE d.status = 'absent'),
        'staff', (SELECT count(*) FROM staff s WHERE s.branch_id = p_branch AND s.status = 'active'))
      FROM staff_attendance_day d WHERE d.branch_id = p_branch AND d.date = p_date),
    'payments', jsonb_build_object(
      'count', (SELECT count(*) FROM payment p WHERE p.branch_id = p_branch AND p.voided_at IS NULL AND p.received_at >= v_start AND p.received_at < v_end),
      'voided', (SELECT count(*) FROM payment p WHERE p.branch_id = p_branch AND p.voided_at >= v_start AND p.voided_at < v_end),
      'cashBox', coalesce((SELECT CASE WHEN c.closed_at IS NULL THEN 'open' ELSE 'closed' END FROM cash_session c WHERE c.branch_id = p_branch AND c.date = p_date), 'none')),
    'expenses', jsonb_build_object(
      'count', (SELECT count(*) FROM expense e WHERE e.branch_id = p_branch AND NOT e.is_request AND e.spent_on = p_date AND e.status IN ('recorded', 'approved', 'pending_approval')),
      'waiting', (SELECT count(*) FROM expense e WHERE e.branch_id = p_branch AND e.status = 'pending_approval')),
    'incidents', jsonb_build_object(
      'count', (SELECT count(*) FROM incident i WHERE i.branch_id = p_branch AND i.occurred_at >= v_start AND i.occurred_at < v_end),
      'critical', (SELECT count(*) FROM incident i WHERE i.branch_id = p_branch AND i.occurred_at >= v_start AND i.occurred_at < v_end AND i.severity = 'critical'),
      'open', (SELECT count(*) FROM incident i WHERE i.branch_id = p_branch AND i.status <> 'closed')),
    'issues', jsonb_build_object(
      'new', (SELECT count(*) FROM issue s WHERE s.branch_id = p_branch AND s.created_at >= v_start AND s.created_at < v_end),
      'resolved', (SELECT count(*) FROM issue s WHERE s.branch_id = p_branch AND s.resolved_at >= v_start AND s.resolved_at < v_end),
      'open', (SELECT count(*) FROM issue s WHERE s.branch_id = p_branch AND s.status <> 'resolved'),
      'overdue', (SELECT count(*) FROM issue s WHERE s.branch_id = p_branch AND s.status <> 'resolved' AND s.due_on < p_date)));
END
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_day_facts(uuid, date) TO yanmu_app;
