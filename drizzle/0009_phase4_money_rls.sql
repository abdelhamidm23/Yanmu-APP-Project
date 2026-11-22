-- Phase 4: who may see and change money records, and the rules the database keeps (spec §5, §7.5, §8.4 to §8.6).
--
--   finance viewers  = owner, company manager, branch manager, accountant, front desk (branch)
--   fee lists, discounts, price locks, routine lists = owner and company manager (settings, §11.8)
--   invoice run      = accountant (spec §5 "Invoices: accountant F"); the nightly job runs without a user
--   payments         = front desk, branch manager (own branch) and accountant
--   credit notes     = accountant creates, branch manager requests; owner or company manager approves
--   expenses         = branch manager (own branch) and accountant record; owner or company manager approves
--   cash box         = front desk and branch manager open and close; accountant reconciles
--
-- Rule 6 (finance is append-only): the app may only INSERT invoices, lines, payments, allocations,
-- credit notes and expenses. Voids, decisions, refunds, closing the cash box and late fees go through
-- the SECURITY DEFINER functions below, which check who is asking.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_finance_viewer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['owner', 'company_manager', 'branch_manager', 'accountant', 'front_desk']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_payment_writer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['front_desk', 'branch_manager', 'accountant']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_money_admin(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['owner', 'company_manager']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_expense_viewer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['owner', 'company_manager', 'branch_manager', 'accountant']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_expense_writer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['branch_manager', 'accountant']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_cash_writer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['front_desk', 'branch_manager']::app_role[])
$$;
--> statement-breakpoint
-- A job run without a signed-in person (the owner connection, never the app role).
CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_current_user_id() IS NULL AND session_user <> 'yanmu_app'
$$;
--> statement-breakpoint

-- A setting for a branch: the branch's own value, else the organization's (spec §17.3).
CREATE OR REPLACE FUNCTION app_setting(p_branch uuid, p_key text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.value FROM setting s JOIN branch b ON b.org_id = s.org_id AND b.id = p_branch
  WHERE s.key = p_key AND (s.branch_id = p_branch OR s.branch_id IS NULL)
  ORDER BY s.branch_id NULLS LAST LIMIT 1
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_setting_bigint(p_branch uuid, p_key text, p_default bigint) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN jsonb_typeof(v) = 'number' THEN (v #>> '{}')::numeric::bigint
              WHEN v IS NULL THEN p_default ELSE NULL END
  FROM (SELECT app_setting(p_branch, p_key) AS v) x
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_cairo_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Africa/Cairo')::date $$;
--> statement-breakpoint

-- Gap-free document numbers per branch, kind and year: A-R2026-00001 (receipt), A-I… (invoice), A-C… (credit note).
-- Demo documents (spec §16) count on their own sequence and read DEMO-A-R2026-00001, so wiping the demo
-- never leaves a gap in the real numbers.
CREATE OR REPLACE FUNCTION app_next_doc_no(p_branch uuid, p_kind text, p_year integer, p_demo boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_no integer;
  v_code text;
  v_kind text := CASE WHEN p_demo THEN p_kind || '_demo' ELSE p_kind END;
BEGIN
  INSERT INTO doc_sequence (branch_id, kind, year, next_no) VALUES (p_branch, v_kind, p_year, 2)
  ON CONFLICT (branch_id, kind, year) DO UPDATE SET next_no = doc_sequence.next_no + 1
  RETURNING next_no - 1 INTO v_no;
  SELECT code INTO v_code FROM branch WHERE id = p_branch;
  RETURN format('%s%s-%s%s-%s', CASE WHEN p_demo THEN 'DEMO-' ELSE '' END, v_code, upper(left(p_kind, 1)), p_year, lpad(v_no::text, 5, '0'));
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Rows that hang off another row take their branch from it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_money_branch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'fee_list_item' THEN
    SELECT branch_id INTO NEW.branch_id FROM fee_list WHERE id = NEW.fee_list_id;
  ELSIF TG_TABLE_NAME IN ('price_lock', 'student_service') THEN
    SELECT branch_id INTO NEW.branch_id FROM student WHERE id = NEW.student_id;
  ELSIF TG_TABLE_NAME = 'invoice_line' THEN
    SELECT branch_id INTO NEW.branch_id FROM invoice WHERE id = NEW.invoice_id;
  ELSIF TG_TABLE_NAME = 'approval_step' THEN
    SELECT branch_id INTO NEW.branch_id FROM approval_request WHERE id = NEW.request_id;
  END IF;
  IF NEW.branch_id IS NULL THEN RAISE EXCEPTION 'parent not found' USING ERRCODE = '23503'; END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER fee_list_item_branch BEFORE INSERT OR UPDATE ON fee_list_item FOR EACH ROW EXECUTE FUNCTION app_money_branch();
--> statement-breakpoint
CREATE TRIGGER price_lock_branch BEFORE INSERT OR UPDATE ON price_lock FOR EACH ROW EXECUTE FUNCTION app_money_branch();
--> statement-breakpoint
CREATE TRIGGER student_service_branch BEFORE INSERT OR UPDATE ON student_service FOR EACH ROW EXECUTE FUNCTION app_money_branch();
--> statement-breakpoint
CREATE TRIGGER invoice_line_branch BEFORE INSERT ON invoice_line FOR EACH ROW EXECUTE FUNCTION app_money_branch();
--> statement-breakpoint
CREATE TRIGGER approval_step_branch BEFORE INSERT ON approval_step FOR EACH ROW EXECUTE FUNCTION app_money_branch();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Invoices: numbers, totals and status are kept by the database.
-- balance = total − credited − paid, where paid = allocations of payments not voided − refunds paid out.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_refresh_invoice(p_invoice uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total bigint;
  v_paid bigint;
  v_credited bigint;
BEGIN
  SELECT coalesce(sum(amount_piastres), 0) INTO v_total FROM invoice_line WHERE invoice_id = p_invoice;
  SELECT coalesce(sum(a.amount_piastres), 0) INTO v_paid
  FROM payment_allocation a JOIN payment p ON p.id = a.payment_id
  WHERE a.invoice_id = p_invoice AND p.voided_at IS NULL;
  SELECT v_paid - coalesce(sum(amount_piastres) FILTER (WHERE kind = 'refund' AND refunded_at IS NOT NULL), 0),
         coalesce(sum(amount_piastres) FILTER (WHERE status = 'approved'), 0)
  INTO v_paid, v_credited FROM credit_note WHERE invoice_id = p_invoice;
  UPDATE invoice SET
    total_piastres = v_total,
    paid_piastres = v_paid,
    credited_piastres = v_credited,
    status = CASE WHEN v_total - v_credited - v_paid <= 0 THEN 'paid' WHEN v_paid > 0 THEN 'part_paid' ELSE 'open' END
  WHERE id = p_invoice;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_invoice_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
BEGIN
  SELECT branch_id, NEW.is_demo OR is_demo INTO v_branch, NEW.is_demo FROM family WHERE id = NEW.family_id;
  IF v_branch IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'family belongs to another branch' USING ERRCODE = '23514';
  END IF;
  IF NEW.student_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM student WHERE id = NEW.student_id AND family_id = NEW.family_id) THEN
    RAISE EXCEPTION 'child is not in this family' USING ERRCODE = '23514';
  END IF;
  IF NEW.student_id IS NULL AND NEW.kind <> 'late_fee' THEN
    RAISE EXCEPTION 'child required' USING ERRCODE = '23514';
  END IF;
  NEW.invoice_no := app_next_doc_no(NEW.branch_id, 'invoice', extract(year FROM NEW.issue_date)::integer, NEW.is_demo);
  NEW.status := 'open';
  NEW.total_piastres := 0;
  NEW.paid_piastres := 0;
  NEW.credited_piastres := 0;
  NEW.late_fee_through := NULL;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_before BEFORE INSERT ON invoice FOR EACH ROW EXECUTE FUNCTION app_invoice_before();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_invoice_line_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_refresh_invoice(NEW.invoice_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_line_after AFTER INSERT ON invoice_line FOR EACH ROW EXECUTE FUNCTION app_invoice_line_after();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Cash box (spec §8.5)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_open_cash_session(p_branch uuid, p_date date) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM cash_session WHERE branch_id = p_branch AND date = p_date AND closed_at IS NULL
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_cash_session_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.cash_in_piastres := NULL;
  NEW.cash_out_piastres := NULL;
  NEW.counted_piastres := NULL;
  NEW.handed_over_piastres := NULL;
  NEW.handed_to := NULL;
  NEW.variance_piastres := NULL;
  NEW.closed_at := NULL;
  NEW.closed_by := NULL;
  NEW.reconciled_at := NULL;
  NEW.reconciled_by := NULL;
  IF NOT app_is_system() AND NEW.date <> app_cairo_today() THEN
    RAISE EXCEPTION 'not_today' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER cash_session_before BEFORE INSERT ON cash_session FOR EACH ROW EXECUTE FUNCTION app_cash_session_before();
--> statement-breakpoint

-- Cash in and out of a session so far: cash payments not voided; cash spent (expenses, not requests) and cash refunds.
CREATE OR REPLACE FUNCTION app_cash_session_totals(p_session uuid, OUT cash_in bigint, OUT cash_out bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
BEGIN
  SELECT branch_id INTO v_branch FROM cash_session WHERE id = p_session;
  IF v_branch IS NULL OR NOT (app_finance_viewer(v_branch) OR app_is_system()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(sum(amount_piastres), 0) INTO cash_in FROM payment WHERE cash_session_id = p_session AND voided_at IS NULL;
  SELECT coalesce((SELECT sum(amount_piastres) FROM expense WHERE cash_session_id = p_session AND NOT is_request), 0)
       + coalesce((SELECT sum(amount_piastres) FROM credit_note WHERE cash_session_id = p_session AND refunded_at IS NOT NULL), 0)
  INTO cash_out;
END
$$;
--> statement-breakpoint

-- variance = opening float + cash in − cash out − handed over − counted (spec §8.5). Positive = cash missing.
CREATE OR REPLACE FUNCTION app_close_cash_session(p_session uuid, p_counted bigint, p_handed_over bigint, p_handed_to text)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s cash_session%ROWTYPE;
  v_in bigint;
  v_out bigint;
  v_variance bigint;
BEGIN
  SELECT * INTO v_s FROM cash_session WHERE id = p_session FOR UPDATE;
  IF v_s.id IS NULL OR NOT (app_cash_writer(v_s.branch_id) OR app_is_system()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_s.closed_at IS NOT NULL THEN RAISE EXCEPTION 'already_closed' USING ERRCODE = '23514'; END IF;
  IF p_counted IS NULL OR p_counted < 0 OR coalesce(p_handed_over, 0) < 0 THEN
    RAISE EXCEPTION 'invalid amount' USING ERRCODE = '23514';
  END IF;
  IF coalesce(p_handed_over, 0) > 0 AND nullif(btrim(p_handed_to), '') IS NULL THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '23514';
  END IF;
  SELECT cash_in, cash_out INTO v_in, v_out FROM app_cash_session_totals(p_session);
  v_variance := v_s.opening_float_piastres + v_in - v_out - coalesce(p_handed_over, 0) - p_counted;
  UPDATE cash_session SET
    cash_in_piastres = v_in, cash_out_piastres = v_out, counted_piastres = p_counted,
    handed_over_piastres = coalesce(p_handed_over, 0), handed_to = nullif(btrim(p_handed_to), ''),
    variance_piastres = v_variance, closed_at = now(), closed_by = app_current_user_id()
  WHERE id = p_session;
  RETURN v_variance;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_reconcile_cash_session(p_session uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s cash_session%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM cash_session WHERE id = p_session FOR UPDATE;
  IF v_s.id IS NULL OR NOT app_has_role_in(v_s.branch_id, ARRAY['accountant']::app_role[]) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_s.closed_at IS NULL THEN RAISE EXCEPTION 'not_closed' USING ERRCODE = '23514'; END IF;
  IF v_s.reconciled_at IS NOT NULL THEN RETURN; END IF;
  UPDATE cash_session SET reconciled_at = now(), reconciled_by = app_current_user_id() WHERE id = p_session;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Payments, receipts and allocation (spec §8.4.3)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_payment_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
BEGIN
  SELECT branch_id, NEW.is_demo OR is_demo INTO v_branch, NEW.is_demo FROM family WHERE id = NEW.family_id;
  IF v_branch IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'family belongs to another branch' USING ERRCODE = '23514';
  END IF;
  NEW.voided_at := NULL;
  NEW.voided_by := NULL;
  NEW.void_reason := NULL;
  NEW.receipt_no := app_next_doc_no(NEW.branch_id, 'receipt', extract(year FROM NEW.received_at AT TIME ZONE 'Africa/Cairo')::integer, NEW.is_demo);
  IF NEW.method = 'cash' THEN
    NEW.cash_session_id := app_open_cash_session(NEW.branch_id, (NEW.received_at AT TIME ZONE 'Africa/Cairo')::date);
    IF NEW.cash_session_id IS NULL AND NOT app_is_system() THEN
      RAISE EXCEPTION 'cash_box_not_open' USING ERRCODE = '23514';
    END IF;
  ELSE
    NEW.cash_session_id := NULL;
  END IF;
  IF NOT app_is_system() AND NEW.received_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid date' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payment_before BEFORE INSERT ON payment FOR EACH ROW EXECUTE FUNCTION app_payment_before();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_allocation_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p payment%ROWTYPE;
  v_i invoice%ROWTYPE;
  v_used bigint;
BEGIN
  SELECT * INTO v_p FROM payment WHERE id = NEW.payment_id FOR UPDATE;
  SELECT * INTO v_i FROM invoice WHERE id = NEW.invoice_id FOR UPDATE;
  IF v_p.id IS NULL OR v_i.id IS NULL THEN RAISE EXCEPTION 'parent not found' USING ERRCODE = '23503'; END IF;
  IF v_p.family_id <> v_i.family_id THEN RAISE EXCEPTION 'invoice of another family' USING ERRCODE = '23514'; END IF;
  IF v_p.voided_at IS NOT NULL THEN RAISE EXCEPTION 'voided' USING ERRCODE = '23514'; END IF;
  NEW.branch_id := v_p.branch_id;
  SELECT coalesce(sum(amount_piastres), 0) INTO v_used FROM payment_allocation WHERE payment_id = NEW.payment_id;
  IF v_used + NEW.amount_piastres > v_p.amount_piastres
     OR NEW.amount_piastres > v_i.total_piastres - v_i.credited_piastres - v_i.paid_piastres THEN
    RAISE EXCEPTION 'over_allocated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payment_allocation_before BEFORE INSERT ON payment_allocation FOR EACH ROW EXECUTE FUNCTION app_allocation_before();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_allocation_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_refresh_invoice(NEW.invoice_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payment_allocation_after AFTER INSERT ON payment_allocation FOR EACH ROW EXECUTE FUNCTION app_allocation_after();
--> statement-breakpoint

-- A void needs a reason and a second person: whoever recorded the payment cannot void it (spec §5, §8.4.3).
-- The payment row stays; its allocations stop counting and the invoices reopen.
CREATE OR REPLACE FUNCTION app_void_payment(p_payment uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p payment%ROWTYPE;
  v_inv uuid;
BEGIN
  SELECT * INTO v_p FROM payment WHERE id = p_payment FOR UPDATE;
  IF v_p.id IS NULL OR NOT app_has_role_in(v_p.branch_id, ARRAY['branch_manager', 'accountant', 'company_manager']::app_role[]) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_p.created_by = app_current_user_id() THEN RAISE EXCEPTION 'own_request' USING ERRCODE = '42501'; END IF;
  IF v_p.voided_at IS NOT NULL THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '23514'; END IF;
  UPDATE payment SET voided_at = now(), voided_by = app_current_user_id(), void_reason = btrim(p_reason) WHERE id = p_payment;
  FOR v_inv IN SELECT DISTINCT invoice_id FROM payment_allocation WHERE payment_id = p_payment LOOP
    PERFORM app_refresh_invoice(v_inv);
    -- Late fees are worked out again for the days this payment had covered.
    UPDATE invoice SET late_fee_through = NULL WHERE id = v_inv;
  END LOOP;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Approvals for money (spec §8.6, §8.4.5): up to the branch manager limit one approver
-- (company manager or owner); above it the company manager recommends and the owner decides.
-- Nobody decides their own request.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_open_money_request(
  p_branch uuid, p_type text, p_amount bigint, p_expense uuid, p_credit_note uuid, p_reason text
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_limit bigint := app_setting_bigint(p_branch, 'approvals.branch_manager_limit_piastres', 2000000);
BEGIN
  INSERT INTO approval_request (branch_id, type, status, amount_piastres, expense_id, credit_note_id, reason, step_count, current_step, created_by, updated_by)
  VALUES (p_branch, p_type, 'pending', p_amount, p_expense, p_credit_note, p_reason,
          CASE WHEN p_amount > v_limit THEN 2 ELSE 1 END, 1, app_current_user_id(), app_current_user_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_decide_money(p_request uuid, p_decision text, p_comment text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_r approval_request%ROWTYPE;
  v_me uuid := app_current_user_id();
  v_owner boolean;
  v_cm boolean;
  v_final text;
  v_cn credit_note%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM approval_request WHERE id = p_request FOR UPDATE;
  IF v_r.id IS NULL OR v_r.type NOT IN ('expense', 'credit_note', 'refund', 'late_fee_waiver') THEN
    RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514';
  END IF;
  p_comment := nullif(btrim(coalesce(p_comment, '')), '');

  -- The person who asked answers a question; the request goes back to the approver.
  IF p_decision = 'answer' THEN
    IF v_r.status <> 'question' THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514'; END IF;
    IF v_r.created_by IS DISTINCT FROM v_me THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
    IF p_comment IS NULL THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '23514'; END IF;
    INSERT INTO approval_step (request_id, branch_id, step_no, decision, comment, created_by, updated_by)
    VALUES (p_request, v_r.branch_id, v_r.current_step, 'answer', p_comment, v_me, v_me);
    UPDATE approval_request SET status = 'pending' WHERE id = p_request;
    RETURN 'pending';
  END IF;

  IF v_r.status <> 'pending' THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514'; END IF;
  IF v_r.created_by = v_me THEN RAISE EXCEPTION 'own_request' USING ERRCODE = '42501'; END IF;
  v_owner := app_has_role_in(v_r.branch_id, ARRAY['owner']::app_role[]);
  v_cm := app_has_role_in(v_r.branch_id, ARRAY['company_manager']::app_role[]);
  IF NOT (v_owner OR v_cm) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_decision IN ('reject', 'question', 'recommend_reject') AND p_comment IS NULL THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '23514';
  END IF;

  IF v_r.step_count = 2 AND v_r.current_step = 1 AND NOT v_owner THEN
    -- Above the limit: the company manager recommends (or asks); the owner decides next.
    IF p_decision NOT IN ('recommend_approve', 'recommend_reject', 'question') THEN
      RAISE EXCEPTION 'owner_decides' USING ERRCODE = '42501';
    END IF;
  ELSIF v_r.step_count = 2 AND NOT v_owner THEN
    RAISE EXCEPTION 'owner_decides' USING ERRCODE = '42501';
  ELSIF p_decision NOT IN ('approve', 'reject', 'question') THEN
    RAISE EXCEPTION 'invalid decision' USING ERRCODE = '22023';
  END IF;

  INSERT INTO approval_step (request_id, branch_id, step_no, decision, comment, created_by, updated_by)
  VALUES (p_request, v_r.branch_id, v_r.current_step, p_decision, p_comment, v_me, v_me);

  IF p_decision = 'question' THEN
    UPDATE approval_request SET status = 'question' WHERE id = p_request;
    RETURN 'question';
  ELSIF p_decision IN ('recommend_approve', 'recommend_reject') THEN
    UPDATE approval_request SET current_step = 2 WHERE id = p_request;
    RETURN 'pending';
  END IF;

  v_final := CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'declined' END;
  UPDATE approval_request
  SET status = v_final, decided_by = v_me, decided_at = now(), decision_note = p_comment, current_step = step_count
  WHERE id = p_request;

  IF v_r.type = 'expense' THEN
    UPDATE expense SET status = CASE WHEN v_final = 'approved' THEN 'approved' ELSE 'rejected' END
    WHERE id = v_r.expense_id AND status = 'pending_approval';
  ELSE
    SELECT * INTO v_cn FROM credit_note WHERE id = v_r.credit_note_id FOR UPDATE;
    IF v_final = 'approved' THEN
      UPDATE credit_note SET status = 'approved',
        credit_no = app_next_doc_no(branch_id, 'credit', extract(year FROM app_cairo_today())::integer,
                                    coalesce((SELECT is_demo FROM invoice WHERE id = v_cn.invoice_id), false))
      WHERE id = v_cn.id;
    ELSE
      UPDATE credit_note SET status = 'rejected' WHERE id = v_cn.id;
    END IF;
    PERFORM app_refresh_invoice(v_cn.invoice_id);
  END IF;
  RETURN v_final;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Credit notes (spec §8.4.5): a correction or waiver can credit what is still billed;
-- a refund can give back what was paid. Waivers are for late-fee invoices.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_credit_note_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_i invoice%ROWTYPE;
  v_pending bigint;
  v_refunds bigint;
BEGIN
  SELECT * INTO v_i FROM invoice WHERE id = NEW.invoice_id FOR UPDATE;
  IF v_i.id IS NULL THEN RAISE EXCEPTION 'parent not found' USING ERRCODE = '23503'; END IF;
  NEW.branch_id := v_i.branch_id;
  NEW.is_demo := NEW.is_demo OR v_i.is_demo;
  NEW.status := 'pending_approval';
  NEW.credit_no := NULL;
  NEW.approval_request_id := NULL;
  NEW.refund_method := NULL;
  NEW.refunded_at := NULL;
  NEW.refunded_by := NULL;
  NEW.cash_session_id := NULL;
  IF length(btrim(NEW.reason)) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '23514'; END IF;
  IF (NEW.kind = 'waiver') <> (v_i.kind = 'late_fee') THEN
    RAISE EXCEPTION 'waiver_late_fee_only' USING ERRCODE = '23514';
  END IF;
  -- pending = every credit note not rejected; refunds = refunds not rejected and not paid out yet.
  SELECT coalesce(sum(amount_piastres), 0) INTO v_pending FROM credit_note WHERE invoice_id = NEW.invoice_id AND status <> 'rejected';
  SELECT coalesce(sum(amount_piastres), 0) INTO v_refunds FROM credit_note
  WHERE invoice_id = NEW.invoice_id AND status <> 'rejected' AND kind = 'refund' AND refunded_at IS NULL;
  IF NEW.amount_piastres > v_i.total_piastres - v_pending
     OR (NEW.kind = 'refund' AND NEW.amount_piastres > v_i.paid_piastres - v_refunds)
     OR (NEW.kind <> 'refund' AND NEW.amount_piastres > v_i.total_piastres - v_pending - v_i.paid_piastres) THEN
    RAISE EXCEPTION 'too_much' USING ERRCODE = '23514';
  END IF;
  -- The approval request is opened here, so the new row already points at it.
  NEW.approval_request_id := app_open_money_request(
    NEW.branch_id,
    CASE NEW.kind WHEN 'refund' THEN 'refund' WHEN 'waiver' THEN 'late_fee_waiver' ELSE 'credit_note' END,
    NEW.amount_piastres, NULL, NEW.id, NEW.reason);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER credit_note_before BEFORE INSERT ON credit_note FOR EACH ROW EXECUTE FUNCTION app_credit_note_before();
--> statement-breakpoint

-- An approved refund is paid back to the family (cash comes out of today's cash box).
CREATE OR REPLACE FUNCTION app_pay_refund(p_credit_note uuid, p_method text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cn credit_note%ROWTYPE;
  v_session uuid;
BEGIN
  SELECT * INTO v_cn FROM credit_note WHERE id = p_credit_note FOR UPDATE;
  IF v_cn.id IS NULL OR NOT app_payment_writer(v_cn.branch_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF v_cn.kind <> 'refund' OR v_cn.status <> 'approved' OR v_cn.refunded_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514';
  END IF;
  IF p_method NOT IN ('cash', 'card', 'bank_transfer', 'instapay', 'wallet') THEN RAISE EXCEPTION 'invalid method' USING ERRCODE = '22023'; END IF;
  IF p_method = 'cash' THEN
    v_session := app_open_cash_session(v_cn.branch_id, app_cairo_today());
    IF v_session IS NULL THEN RAISE EXCEPTION 'cash_box_not_open' USING ERRCODE = '23514'; END IF;
  END IF;
  UPDATE credit_note SET refund_method = p_method, refunded_at = now(), refunded_by = app_current_user_id(), cash_session_id = v_session
  WHERE id = p_credit_note;
  PERFORM app_refresh_invoice(v_cn.invoice_id);
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Expenses (spec §8.6, D10). The database decides routine or not:
--   routine = category on the branch's routine list
--             AND amount <= multiplier × the category's average single expense in the last 3 months
--                 (skipped while the category has less than 3 months of history)
--             AND amount <= the branch manager limit AND not flagged as unusual by the person.
-- Anything else goes to approval.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_expense_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit bigint := app_setting_bigint(NEW.branch_id, 'approvals.branch_manager_limit_piastres', 2000000);
  v_photo bigint := app_setting_bigint(NEW.branch_id, 'expenses.photo_required_from_piastres', 10000);
  v_mult numeric := coalesce((app_setting(NEW.branch_id, 'approvals.unusual_multiplier') #>> '{}')::numeric, 2.0);
  v_avg numeric;
  v_reasons text[] := '{}';
  v_orig expense%ROWTYPE;
BEGIN
  NEW.approval_request_id := NULL;
  IF NEW.reverses_expense_id IS NOT NULL THEN
    -- A reversal cancels a recorded or approved expense of the same branch, for the same amount.
    SELECT * INTO v_orig FROM expense WHERE id = NEW.reverses_expense_id FOR UPDATE;
    IF v_orig.id IS NULL OR v_orig.branch_id <> NEW.branch_id OR v_orig.status NOT IN ('recorded', 'approved')
       OR v_orig.reverses_expense_id IS NOT NULL THEN
      RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514';
    END IF;
    IF length(btrim(coalesce(NEW.description, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '23514'; END IF;
    NEW.amount_piastres := -v_orig.amount_piastres;
    NEW.category_id := v_orig.category_id;
    NEW.vendor_id := v_orig.vendor_id;
    NEW.payment_method := v_orig.payment_method;
    NEW.status := 'recorded';
    NEW.is_unusual := false;
    NEW.unusual_reason := NULL;
    NEW.is_request := false;
    NEW.cash_session_id := CASE WHEN v_orig.payment_method = 'cash' AND v_orig.cash_session_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM cash_session WHERE id = v_orig.cash_session_id AND closed_at IS NULL)
      THEN v_orig.cash_session_id END;
    RETURN NEW;
  END IF;

  IF NEW.amount_piastres <= 0 THEN RAISE EXCEPTION 'invalid amount' USING ERRCODE = '23514'; END IF;
  IF NOT NEW.is_request AND NEW.spent_on > app_cairo_today() AND NOT app_is_system() THEN
    RAISE EXCEPTION 'invalid date' USING ERRCODE = '23514';
  END IF;
  IF NOT NEW.is_request AND NEW.receipt_attachment_id IS NULL AND NEW.amount_piastres >= v_photo THEN
    RAISE EXCEPTION 'receipt_required' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM branch_routine_category WHERE branch_id = NEW.branch_id AND category_id = NEW.category_id) THEN
    v_reasons := array_append(v_reasons, 'not_routine');
  ELSIF EXISTS (
    SELECT 1 FROM expense
    WHERE branch_id = NEW.branch_id AND category_id = NEW.category_id AND amount_piastres > 0
      AND status IN ('recorded', 'approved', 'reversed') AND spent_on <= NEW.spent_on - interval '3 months'
  ) THEN
    SELECT avg(amount_piastres) INTO v_avg FROM expense
    WHERE branch_id = NEW.branch_id AND category_id = NEW.category_id AND amount_piastres > 0
      AND status IN ('recorded', 'approved') AND reverses_expense_id IS NULL
      AND spent_on >= NEW.spent_on - interval '3 months' AND spent_on < NEW.spent_on;
    IF v_avg IS NOT NULL AND NEW.amount_piastres > v_mult * v_avg THEN v_reasons := array_append(v_reasons, 'above_average'); END IF;
  END IF;
  IF NEW.amount_piastres > v_limit THEN v_reasons := array_append(v_reasons, 'above_limit'); END IF;
  IF nullif(btrim(coalesce(NEW.flagged_note, '')), '') IS NOT NULL THEN v_reasons := array_append(v_reasons, 'flagged'); END IF;

  NEW.is_unusual := cardinality(v_reasons) > 0;
  NEW.unusual_reason := nullif(array_to_string(v_reasons, ','), '');
  NEW.status := CASE WHEN NEW.is_unusual THEN 'pending_approval' ELSE 'recorded' END;
  -- Routine requests before spending need no request: they are simply recorded when spent.
  IF NEW.is_request AND NOT NEW.is_unusual THEN RAISE EXCEPTION 'request_not_needed' USING ERRCODE = '23514'; END IF;
  NEW.cash_session_id := CASE WHEN NEW.payment_method = 'cash' AND NOT NEW.is_request
    THEN app_open_cash_session(NEW.branch_id, NEW.spent_on) END;
  IF NEW.is_unusual THEN
    NEW.approval_request_id := app_open_money_request(NEW.branch_id, 'expense', NEW.amount_piastres, NEW.id, NULL, NEW.unusual_reason);
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER expense_before BEFORE INSERT ON expense FOR EACH ROW EXECUTE FUNCTION app_expense_before();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_expense_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.reverses_expense_id IS NOT NULL THEN
    UPDATE expense SET status = 'reversed' WHERE id = NEW.reverses_expense_id;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER expense_after AFTER INSERT ON expense FOR EACH ROW WHEN (NEW.reverses_expense_id IS NOT NULL) EXECUTE FUNCTION app_expense_after();
--> statement-breakpoint

-- A request made before spending is completed with the receipt once the money is spent.
CREATE OR REPLACE FUNCTION app_complete_expense_request(p_expense uuid, p_receipt uuid, p_spent_on date) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_e expense%ROWTYPE;
BEGIN
  SELECT * INTO v_e FROM expense WHERE id = p_expense FOR UPDATE;
  IF v_e.id IS NULL OR NOT app_expense_writer(v_e.branch_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT v_e.is_request OR v_e.status NOT IN ('pending_approval', 'approved') THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = '23514'; END IF;
  IF p_spent_on IS NULL OR p_spent_on > app_cairo_today() THEN RAISE EXCEPTION 'invalid date' USING ERRCODE = '23514'; END IF;
  IF p_receipt IS NULL OR NOT EXISTS (SELECT 1 FROM attachment WHERE id = p_receipt AND branch_id = v_e.branch_id) THEN
    RAISE EXCEPTION 'receipt_required' USING ERRCODE = '23514';
  END IF;
  UPDATE expense SET is_request = false, receipt_attachment_id = p_receipt, spent_on = p_spent_on,
    cash_session_id = CASE WHEN payment_method = 'cash' THEN app_open_cash_session(branch_id, p_spent_on) END
  WHERE id = p_expense;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Late fees (spec §8.4.4, D5): from the first working day after the due date, a tuition invoice with
-- any unpaid balance at the start of the day gets one late-fee line per working day, on a separate
-- late-fee invoice for that child and month (or family, if late_fee.basis = per_family).
-- Idempotent: a day already charged is skipped. Runs nightly (scripts/jobs.ts) and is caught up when
-- money screens open. Lines are written as the system, not as the person who opened the screen.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_tuition_balance_at(p_invoice uuid, p_at timestamptz) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.total_piastres
    - coalesce((SELECT sum(c.amount_piastres) FROM credit_note c
                JOIN approval_request r ON r.id = c.approval_request_id
                WHERE c.invoice_id = i.id AND c.status = 'approved' AND r.decided_at < p_at), 0)
    - coalesce((SELECT sum(a.amount_piastres) FROM payment_allocation a JOIN payment p ON p.id = a.payment_id
                WHERE a.invoice_id = i.id AND p.voided_at IS NULL AND p.received_at < p_at), 0)
    + coalesce((SELECT sum(c.amount_piastres) FROM credit_note c
                WHERE c.invoice_id = i.id AND c.kind = 'refund' AND c.refunded_at < p_at), 0)
  FROM invoice i WHERE i.id = p_invoice
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_accrue_late_fees(p_branch uuid, p_today date) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_daily bigint := app_setting_bigint(p_branch, 'late_fee.daily_piastres', 50000);
  v_cap bigint := app_setting_bigint(p_branch, 'late_fee.cap_piastres', NULL);
  v_basis text := coalesce(app_setting(p_branch, 'late_fee.basis') #>> '{}', 'per_invoice');
  v_user text := current_setting('app.user_id', true);
  v_i invoice%ROWTYPE;
  v_lf invoice%ROWTYPE;
  v_day date;
  v_added integer := 0;
BEGIN
  IF NOT (app_finance_viewer(p_branch) OR app_is_system()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_today > app_cairo_today() THEN p_today := app_cairo_today(); END IF;
  IF v_daily IS NULL OR v_daily <= 0 THEN RETURN 0; END IF;
  -- Written as the system: created_by and the audit actor stay empty.
  PERFORM set_config('app.user_id', '', true);

  FOR v_i IN
    SELECT * FROM invoice
    WHERE branch_id = p_branch AND kind = 'tuition' AND due_date < p_today
      AND (late_fee_through IS NULL OR late_fee_through < p_today)
    ORDER BY due_date, id
    FOR UPDATE
  LOOP
    v_day := greatest(v_i.due_date + 1, coalesce(v_i.late_fee_through + 1, v_i.due_date + 1));
    WHILE v_day <= p_today LOOP
      IF is_working_day(p_branch, v_day)
         AND app_tuition_balance_at(v_i.id, (v_day::timestamp AT TIME ZONE 'Africa/Cairo')) > 0 THEN
        SELECT * INTO v_lf FROM invoice
        WHERE kind = 'late_fee' AND service_month = v_i.service_month
          AND CASE WHEN v_basis = 'per_family' THEN family_id = v_i.family_id AND student_id IS NULL
                   ELSE student_id = v_i.student_id END;
        IF v_lf.id IS NULL THEN
          INSERT INTO invoice (branch_id, family_id, student_id, service_month, issue_date, due_date, kind, is_demo)
          VALUES (p_branch, v_i.family_id, CASE WHEN v_basis = 'per_family' THEN NULL ELSE v_i.student_id END,
                  v_i.service_month, v_day, v_day, 'late_fee', v_i.is_demo)
          RETURNING * INTO v_lf;
        END IF;
        IF v_cap IS NULL OR v_lf.total_piastres < v_cap THEN
          INSERT INTO invoice_line (invoice_id, branch_id, item_type, description, quantity, unit_piastres, amount_piastres, source, accrual_date)
          VALUES (v_lf.id, p_branch, 'late_fee', 'late_fee', 1, v_daily,
                  CASE WHEN v_cap IS NULL THEN v_daily ELSE least(v_daily, v_cap - v_lf.total_piastres) END, 'late_fee', v_day)
          ON CONFLICT (invoice_id, accrual_date) WHERE accrual_date IS NOT NULL DO NOTHING;
          IF FOUND THEN v_added := v_added + 1; END IF;
        END IF;
        v_lf := NULL;
      END IF;
      v_day := v_day + 1;
    END LOOP;
    UPDATE invoice SET late_fee_through = p_today WHERE id = v_i.id;
  END LOOP;

  PERFORM set_config('app.user_id', coalesce(v_user, ''), true);
  RETURN v_added;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Approval requests: money requests are seen by the accountant too, and their steps by whoever sees the request.
-- ---------------------------------------------------------------------------

DROP POLICY approval_request_read ON approval_request;
--> statement-breakpoint
CREATE POLICY approval_request_read ON approval_request FOR SELECT TO yanmu_app
  USING (
    created_by = app_current_user_id()
    OR app_has_role_in(branch_id, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[])
    OR (to_branch_id IS NOT NULL AND app_has_role_in(to_branch_id, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[]))
    OR (type IN ('expense', 'credit_note', 'refund', 'late_fee_waiver') AND app_has_role_in(branch_id, ARRAY['accountant']::app_role[]))
  );
--> statement-breakpoint
DROP POLICY approval_request_insert ON approval_request;
--> statement-breakpoint
CREATE POLICY approval_request_insert ON approval_request FOR INSERT TO yanmu_app
  WITH CHECK (app_child_writer(branch_id) AND type IN ('over_capacity', 'transfer') AND status = 'pending' AND decided_by IS NULL);
--> statement-breakpoint
DROP POLICY approval_request_update ON approval_request;
--> statement-breakpoint
CREATE POLICY approval_request_update ON approval_request FOR UPDATE TO yanmu_app
  USING (created_by = app_current_user_id() AND status = 'pending' AND type IN ('over_capacity', 'transfer'))
  WITH CHECK (status = 'cancelled' AND decided_by IS NULL);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit (rule 7): every money table. branch_routine_category has no id of its own.
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
    CASE WHEN TG_TABLE_NAME = 'branch_routine_category' THEN concat_ws('/', v_row ->> 'branch_id', v_row ->> 'category_id') END,
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
  FOREACH t IN ARRAY ARRAY['fee_list', 'fee_list_item', 'price_lock', 'discount_rule', 'student_service', 'invoice',
                           'invoice_line', 'cash_session', 'payment', 'payment_allocation', 'credit_note',
                           'expense_category', 'branch_routine_category', 'vendor', 'expense', 'approval_step'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t || '_audit', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_columns()', t || '_set_updated', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['fee_list', 'fee_list_item', 'price_lock', 'discount_rule', 'student_service', 'doc_sequence',
                           'invoice', 'invoice_line', 'cash_session', 'payment', 'payment_allocation', 'credit_note',
                           'expense_category', 'branch_routine_category', 'vendor', 'expense', 'approval_step'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Privileges. Finance rows are insert-only for the app (rule 6).
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON fee_list, fee_list_item, discount_rule, student_service, branch_routine_category TO yanmu_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON price_lock, expense_category, vendor TO yanmu_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON invoice, invoice_line, payment, payment_allocation, credit_note, expense, cash_session TO yanmu_app;
--> statement-breakpoint
GRANT SELECT ON approval_step TO yanmu_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_close_cash_session(uuid, bigint, bigint, text), app_reconcile_cash_session(uuid),
  app_cash_session_totals(uuid), app_void_payment(uuid, text), app_decide_money(uuid, text, text),
  app_pay_refund(uuid, text), app_complete_expense_request(uuid, uuid, date), app_accrue_late_fees(uuid, date) TO yanmu_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

CREATE POLICY fee_list_read ON fee_list FOR SELECT TO yanmu_app USING (app_finance_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY fee_list_write ON fee_list FOR ALL TO yanmu_app USING (app_money_admin(branch_id)) WITH CHECK (app_money_admin(branch_id));
--> statement-breakpoint
CREATE POLICY fee_list_item_read ON fee_list_item FOR SELECT TO yanmu_app USING (app_finance_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY fee_list_item_write ON fee_list_item FOR ALL TO yanmu_app USING (app_money_admin(branch_id)) WITH CHECK (app_money_admin(branch_id));
--> statement-breakpoint
CREATE POLICY discount_rule_read ON discount_rule FOR SELECT TO yanmu_app USING (app_finance_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY discount_rule_write ON discount_rule FOR ALL TO yanmu_app USING (app_money_admin(branch_id)) WITH CHECK (app_money_admin(branch_id));
--> statement-breakpoint

CREATE POLICY price_lock_read ON price_lock FOR SELECT TO yanmu_app USING (app_finance_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY price_lock_insert ON price_lock FOR INSERT TO yanmu_app WITH CHECK (app_money_admin(branch_id));
--> statement-breakpoint
CREATE POLICY price_lock_update ON price_lock FOR UPDATE TO yanmu_app USING (app_money_admin(branch_id)) WITH CHECK (app_money_admin(branch_id));
--> statement-breakpoint

CREATE POLICY student_service_read ON student_service FOR SELECT TO yanmu_app USING (app_finance_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY student_service_write ON student_service FOR ALL TO yanmu_app
  USING (app_child_writer(branch_id) OR app_money_admin(branch_id)) WITH CHECK (app_child_writer(branch_id) OR app_money_admin(branch_id));
--> statement-breakpoint

CREATE POLICY invoice_read ON invoice FOR SELECT TO yanmu_app USING (app_finance_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY invoice_insert ON invoice FOR INSERT TO yanmu_app
  WITH CHECK (app_has_role_in(branch_id, ARRAY['accountant']::app_role[]) AND kind IN ('tuition', 'other'));
--> statement-breakpoint
CREATE POLICY invoice_line_read ON invoice_line FOR SELECT TO yanmu_app USING (app_finance_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY invoice_line_insert ON invoice_line FOR INSERT TO yanmu_app
  WITH CHECK (app_has_role_in(branch_id, ARRAY['accountant']::app_role[]) AND source <> 'late_fee'
              AND EXISTS (SELECT 1 FROM invoice i WHERE i.id = invoice_id AND i.kind <> 'late_fee'));
--> statement-breakpoint

CREATE POLICY cash_session_read ON cash_session FOR SELECT TO yanmu_app USING (app_finance_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY cash_session_insert ON cash_session FOR INSERT TO yanmu_app WITH CHECK (app_cash_writer(branch_id));
--> statement-breakpoint

CREATE POLICY payment_read ON payment FOR SELECT TO yanmu_app USING (app_finance_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY payment_insert ON payment FOR INSERT TO yanmu_app WITH CHECK (app_payment_writer(branch_id));
--> statement-breakpoint
CREATE POLICY payment_allocation_read ON payment_allocation FOR SELECT TO yanmu_app USING (app_finance_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY payment_allocation_insert ON payment_allocation FOR INSERT TO yanmu_app WITH CHECK (app_payment_writer(branch_id));
--> statement-breakpoint

CREATE POLICY credit_note_read ON credit_note FOR SELECT TO yanmu_app USING (app_finance_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY credit_note_insert ON credit_note FOR INSERT TO yanmu_app
  WITH CHECK (app_has_role_in(branch_id, ARRAY['accountant', 'branch_manager']::app_role[]));
--> statement-breakpoint

CREATE POLICY expense_category_read ON expense_category FOR SELECT TO yanmu_app USING (app_current_user_id() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY expense_category_write ON expense_category FOR INSERT TO yanmu_app WITH CHECK (app_is_org_admin());
--> statement-breakpoint
CREATE POLICY expense_category_update ON expense_category FOR UPDATE TO yanmu_app USING (app_is_org_admin()) WITH CHECK (app_is_org_admin());
--> statement-breakpoint
CREATE POLICY branch_routine_category_read ON branch_routine_category FOR SELECT TO yanmu_app USING (app_expense_viewer(branch_id));
--> statement-breakpoint
CREATE POLICY branch_routine_category_write ON branch_routine_category FOR ALL TO yanmu_app
  USING (app_money_admin(branch_id)) WITH CHECK (app_money_admin(branch_id));
--> statement-breakpoint
CREATE POLICY vendor_read ON vendor FOR SELECT TO yanmu_app
  USING (EXISTS (SELECT 1 FROM app_active_roles() r WHERE r.role IN ('owner', 'company_manager', 'branch_manager', 'accountant')));
--> statement-breakpoint
CREATE POLICY vendor_insert ON vendor FOR INSERT TO yanmu_app
  WITH CHECK (EXISTS (SELECT 1 FROM app_active_roles() r WHERE r.role IN ('company_manager', 'branch_manager', 'accountant')));
--> statement-breakpoint
CREATE POLICY vendor_update ON vendor FOR UPDATE TO yanmu_app USING (app_is_org_admin()) WITH CHECK (app_is_org_admin());
--> statement-breakpoint

-- Front desk sees the cash expenses of its cash box (to count it), nothing else.
CREATE POLICY expense_read ON expense FOR SELECT TO yanmu_app
  USING (app_expense_viewer(branch_id) OR (cash_session_id IS NOT NULL AND app_cash_writer(branch_id)));
--> statement-breakpoint
CREATE POLICY expense_insert ON expense FOR INSERT TO yanmu_app WITH CHECK (app_expense_writer(branch_id));
--> statement-breakpoint

CREATE POLICY approval_step_read ON approval_step FOR SELECT TO yanmu_app
  USING (EXISTS (SELECT 1 FROM approval_request r WHERE r.id = request_id));
--> statement-breakpoint

-- Audit log (spec §5): the accountant reads the finance rows of their branches.
CREATE POLICY audit_event_read_finance ON audit_event FOR SELECT TO yanmu_app
  USING (
    table_name IN ('fee_list', 'fee_list_item', 'price_lock', 'discount_rule', 'student_service', 'invoice', 'invoice_line',
                   'cash_session', 'payment', 'payment_allocation', 'credit_note', 'expense_category',
                   'branch_routine_category', 'vendor', 'expense', 'approval_step')
    AND (branch_id IN (SELECT r.branch_id FROM app_active_roles() r WHERE r.role = 'accountant')
         OR (SELECT EXISTS (SELECT 1 FROM app_active_roles() r WHERE r.role = 'accountant' AND r.branch_id IS NULL)))
  );
--> statement-breakpoint
-- The audit log grows by every money change (about 1,000 rows a day per branch). Wrapping the role
-- check in a sub-select makes PostgreSQL work it out once per query instead of once per row.
DROP POLICY audit_event_read ON audit_event;
--> statement-breakpoint
CREATE POLICY audit_event_read ON audit_event FOR SELECT TO yanmu_app USING ((SELECT app_is_org_admin()));
--> statement-breakpoint

-- Receipt photos of expenses (spec §8.6) are attachments too. Expense writers may upload them and read
-- what they uploaded; expense viewers read the receipts of expenses they can see. Children's photos
-- and forms stay with the Phase 2 policy.
CREATE POLICY attachment_read_expense ON attachment FOR SELECT TO yanmu_app
  USING (
    (app_expense_writer(branch_id) AND created_by = app_current_user_id())
    OR (app_expense_viewer(branch_id) AND EXISTS (SELECT 1 FROM expense e WHERE e.receipt_attachment_id = attachment.id))
  );
--> statement-breakpoint
CREATE POLICY attachment_insert_expense ON attachment FOR INSERT TO yanmu_app WITH CHECK (app_expense_writer(branch_id));
