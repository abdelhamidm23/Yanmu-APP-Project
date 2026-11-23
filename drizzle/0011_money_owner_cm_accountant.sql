-- Owner's answer on the Phase 4 review (2026-11-23): money is for the accountant, the owner and the
-- company manager. The branch manager no longer sees money figures, takes payments, runs the cash box,
-- requests credit notes or voids payments. Like the front desk, the branch manager sees which families
-- have paid (app_family_pay_status, no amounts), and still records the branch's expenses for approval.
--
--   finance viewers = owner, company manager, accountant
--   payments        = accountant
--   cash box        = accountant opens, closes and checks it
--   credit notes    = accountant (approved by owner or company manager)
--   voids           = accountant or company manager (never the person who took the payment)
--   expenses        = branch manager and accountant record; owner, company manager, branch manager, accountant see
-- src/lib/permissions.ts mirrors this.

CREATE OR REPLACE FUNCTION app_finance_viewer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['owner', 'company_manager', 'accountant']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_payment_writer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['accountant']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_cash_writer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['accountant']::app_role[])
$$;
--> statement-breakpoint

DROP POLICY credit_note_insert ON credit_note;
--> statement-breakpoint
CREATE POLICY credit_note_insert ON credit_note FOR INSERT TO yanmu_app
  WITH CHECK (app_has_role_in(branch_id, ARRAY['accountant']::app_role[]));
--> statement-breakpoint

-- Credit notes, refunds and late-fee waivers carry family balances: the branch manager no longer sees
-- them. Expense requests and the children requests (over capacity, transfers) stay visible.
DROP POLICY approval_request_read ON approval_request;
--> statement-breakpoint
CREATE POLICY approval_request_read ON approval_request FOR SELECT TO yanmu_app
  USING (
    created_by = app_current_user_id()
    OR app_has_role_in(branch_id, ARRAY['owner', 'company_manager']::app_role[])
    OR (type NOT IN ('credit_note', 'refund', 'late_fee_waiver') AND app_has_role_in(branch_id, ARRAY['branch_manager']::app_role[]))
    OR (to_branch_id IS NOT NULL AND app_has_role_in(to_branch_id, ARRAY['owner', 'company_manager', 'branch_manager']::app_role[]))
    OR (type IN ('expense', 'credit_note', 'refund', 'late_fee_waiver') AND app_has_role_in(branch_id, ARRAY['accountant']::app_role[]))
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_void_payment(p_payment uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p payment%ROWTYPE;
  v_inv uuid;
BEGIN
  SELECT * INTO v_p FROM payment WHERE id = p_payment FOR UPDATE;
  IF v_p.id IS NULL OR NOT app_has_role_in(v_p.branch_id, ARRAY['accountant', 'company_manager']::app_role[]) THEN
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
