-- Owner's review of Phase 4 (2026-11-23): "the accountant is the one that does all the finances, not
-- the front desk. The front desk can check with the accountant who paid and who not, but the details
-- of how much we earned are for the accountant."
--
--   finance viewers = owner, company manager, branch manager, accountant (front desk removed)
--   payments        = branch manager (own branch) and accountant (front desk removed)
--   cash box        = accountant and branch manager open and close (was front desk and branch manager)
--   front desk      = app_family_pay_status: which families have paid, with no amounts
-- Branch managers keep what they had. src/lib/permissions.ts mirrors this.

CREATE OR REPLACE FUNCTION app_finance_viewer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['owner', 'company_manager', 'branch_manager', 'accountant']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_payment_writer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['branch_manager', 'accountant']::app_role[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_cash_writer(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_role_in(p_branch, ARRAY['accountant', 'branch_manager']::app_role[])
$$;
--> statement-breakpoint

-- Which families of a branch have paid, with no amounts. One row per family that has a child now
-- (active or waiting to start) or still owes something.
--   status: paid (billed, nothing left to pay) · due (owes, not past the due date yet)
--           late (owes, past the due date) · not_billed (no invoice yet: never shown as paid, rule 1)
--   since:  the oldest due date still owed
-- Returns nothing to anyone without a money or front desk role in the branch.
CREATE OR REPLACE FUNCTION app_family_pay_status(p_branch uuid)
RETURNS TABLE (family_id uuid, status text, since date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH inv AS (
    SELECT i.family_id,
      count(*) AS billed,
      min(i.due_date) FILTER (WHERE i.total_piastres - i.paid_piastres - i.credited_piastres > 0) AS oldest_open
    FROM invoice i WHERE i.branch_id = p_branch GROUP BY i.family_id
  )
  SELECT f.id,
    CASE WHEN inv.billed IS NULL THEN 'not_billed'
         WHEN inv.oldest_open IS NULL THEN 'paid'
         WHEN inv.oldest_open < app_cairo_today() THEN 'late'
         ELSE 'due' END,
    inv.oldest_open
  FROM family f LEFT JOIN inv ON inv.family_id = f.id
  WHERE f.branch_id = p_branch
    AND app_has_role_in(p_branch, ARRAY['owner', 'company_manager', 'branch_manager', 'accountant', 'front_desk']::app_role[])
    AND (inv.oldest_open IS NOT NULL
      OR EXISTS (SELECT 1 FROM student s WHERE s.family_id = f.id AND s.status IN ('active', 'pending')))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_family_pay_status(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_family_pay_status(uuid) TO yanmu_app;
