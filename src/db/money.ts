import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "./rls";
import { monthStart } from "@/lib/billing";
import { cairoWallToUtc } from "@/lib/calendar";

const big = (v: unknown) => BigInt((v as string | number | null) ?? 0);

/** Start of a Cairo calendar day as a UTC instant. */
export function cairoDayStart(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return cairoWallToUtc(y, m, d);
}

export interface MoneySummary {
  month: string;
  /** Tuition and services billed for this month, minus approved credit notes on them (late fees apart, spec §9.1). */
  billed: bigint;
  invoicesThisMonth: number;
  collected: { tuition: bigint; lateFees: bigint; other: bigint; onAccount: bigint; total: bigint; count: number };
  overdue: { total: bigint; families: number; buckets: { d1_30: bigint; d31_60: bigint; d60_plus: bigint } };
  lateFees: { outstanding: bigint; families: number; today: bigint; todayFamilies: number };
  paymentsToday: { count: number; total: bigint };
  approvalsWaiting: number;
  cashBox: "none" | "open" | "closed";
}

/** The figures on the Money screen for one branch (spec §9.1). Every figure comes from records. */
export async function moneySummary(tx: Tx, branchId: string, today: string): Promise<MoneySummary> {
  const month = monthStart(today);
  const monthAt = cairoDayStart(month);
  const dayAt = cairoDayStart(today);
  const [billing] = (await tx.execute(sql`
    select
      coalesce(sum(i.total_piastres - i.credited_piastres), 0)::text as billed,
      count(*)::int as n
    from invoice i
    where i.branch_id = ${branchId} and i.service_month = ${month} and i.kind <> 'late_fee'`)) as unknown as { billed: string; n: number }[];

  const [collected] = (await tx.execute(sql`
    with p as (
      select id, amount_piastres from payment
      where branch_id = ${branchId} and voided_at is null and received_at >= ${monthAt.toISOString()}
    ), a as (
      select a.payment_id, i.kind, a.amount_piastres from payment_allocation a
      join p on p.id = a.payment_id join invoice i on i.id = a.invoice_id
    )
    select
      coalesce((select sum(amount_piastres) from a where kind = 'tuition'), 0)::text as tuition,
      coalesce((select sum(amount_piastres) from a where kind = 'late_fee'), 0)::text as "lateFees",
      coalesce((select sum(amount_piastres) from a where kind = 'other'), 0)::text as other,
      coalesce((select sum(amount_piastres) from p), 0)::text as total,
      (select count(*) from p)::int as n`)) as unknown as Record<string, string | number>[];

  const [overdue] = (await tx.execute(sql`
    with o as (
      select family_id, ${today}::date - due_date as days, total_piastres - paid_piastres - credited_piastres as bal
      from invoice
      where branch_id = ${branchId} and kind <> 'late_fee' and status <> 'paid' and due_date < ${today}
    )
    select
      coalesce(sum(bal) filter (where bal > 0), 0)::text as total,
      count(distinct family_id) filter (where bal > 0)::int as families,
      coalesce(sum(bal) filter (where bal > 0 and days <= 30), 0)::text as b1,
      coalesce(sum(bal) filter (where bal > 0 and days between 31 and 60), 0)::text as b2,
      coalesce(sum(bal) filter (where bal > 0 and days > 60), 0)::text as b3
    from o`)) as unknown as Record<string, string | number>[];

  const [late] = (await tx.execute(sql`
    select
      coalesce(sum(total_piastres - paid_piastres - credited_piastres) filter (where status <> 'paid'), 0)::text as outstanding,
      count(distinct family_id) filter (where status <> 'paid' and total_piastres - paid_piastres - credited_piastres > 0)::int as families,
      coalesce((select sum(l.amount_piastres) from invoice_line l join invoice i2 on i2.id = l.invoice_id
                where i2.branch_id = ${branchId} and l.accrual_date = ${today}), 0)::text as today,
      (select count(distinct i2.family_id) from invoice_line l join invoice i2 on i2.id = l.invoice_id
       where i2.branch_id = ${branchId} and l.accrual_date = ${today})::int as "todayFamilies"
    from invoice where branch_id = ${branchId} and kind = 'late_fee'`)) as unknown as Record<string, string | number>[];

  const [misc] = (await tx.execute(sql`
    select
      (select count(*) from payment where branch_id = ${branchId} and voided_at is null and received_at >= ${dayAt.toISOString()})::int as "payN",
      (select coalesce(sum(amount_piastres), 0) from payment where branch_id = ${branchId} and voided_at is null and received_at >= ${dayAt.toISOString()})::text as "payT",
      (select count(*) from approval_request where branch_id = ${branchId} and status in ('pending', 'question')
         and type in ('expense', 'credit_note', 'refund', 'late_fee_waiver'))::int as approvals,
      (select case when closed_at is null then 'open' else 'closed' end from cash_session where branch_id = ${branchId} and date = ${today}) as cash`)) as unknown as Record<string, string | number | null>[];

  const allocated = big(collected.tuition) + big(collected.lateFees) + big(collected.other);
  return {
    month,
    billed: big(billing.billed),
    invoicesThisMonth: billing.n,
    collected: {
      tuition: big(collected.tuition),
      lateFees: big(collected.lateFees),
      other: big(collected.other),
      onAccount: big(collected.total) - allocated,
      total: big(collected.total),
      count: Number(collected.n),
    },
    overdue: { total: big(overdue.total), families: Number(overdue.families), buckets: { d1_30: big(overdue.b1), d31_60: big(overdue.b2), d60_plus: big(overdue.b3) } },
    lateFees: { outstanding: big(late.outstanding), families: Number(late.families), today: big(late.today), todayFamilies: Number(late.todayFamilies) },
    paymentsToday: { count: Number(misc.payN), total: big(misc.payT) },
    approvalsWaiting: Number(misc.approvals),
    cashBox: (misc.cash as "open" | "closed" | null) ?? "none",
  };
}

/** Families of a branch matching a search (account number, family name, child name, or a parent's phone). */
export async function findFamilies(tx: Tx, branchId: string, q: string) {
  const like = `%${q.trim()}%`;
  return (await tx.execute(sql`
    select * from (
      select f.id, f.account_no as "accountNo", f.display_name as "displayName",
        coalesce(string_agg(distinct s.full_name_ar, '، '), '') as "childrenAr",
        coalesce(string_agg(distinct s.full_name_en, ', '), '') as "childrenEn",
        (select coalesce(sum(i.total_piastres - i.paid_piastres - i.credited_piastres), 0) from invoice i
          where i.family_id = f.id and i.status <> 'paid') as owed
      from family f
      left join student s on s.family_id = f.id and s.status in ('active', 'pending')
      where f.branch_id = ${branchId} and (
        ${q.trim()} = '' or f.account_no ilike ${like} or f.display_name ilike ${like}
        or s.full_name_ar ilike ${like} or s.full_name_en ilike ${like}
        or exists (select 1 from guardian g where g.family_id = f.id and g.phone like ${like})
      )
      group by f.id
    ) x
    order by owed desc, "accountNo"
    limit 30`)) as unknown as { id: string; accountNo: string; displayName: string; childrenAr: string; childrenEn: string; owed: string }[];
}

export type TrailStep = { stepNo: number; decision: string; comment: string | null; at: Date; byName: string | null; byId: string | null };
export type MoneyRequest = {
  id: string; type: string; status: string; amount: string | null; currentStep: number; stepCount: number; reason: string | null;
  requestedBy: string | null; requestedByName: string | null; createdAt: Date; decidedAt: Date | null;
};

/** A money approval and every decision on it, oldest first (spec §8.6: rejections stay visible). */
export async function approvalTrail(tx: Tx, requestId: string): Promise<{ request: MoneyRequest; steps: TrailStep[] } | null> {
  const [request] = (await tx.execute(sql`
    select r.id, r.type, r.status, r.amount_piastres::text as amount, r.current_step as "currentStep", r.step_count as "stepCount",
      r.reason, r.created_by as "requestedBy", u.full_name as "requestedByName", r.created_at as "createdAt", r.decided_at as "decidedAt"
    from approval_request r left join app_user u on u.id = r.created_by where r.id = ${requestId}`)) as unknown as MoneyRequest[];
  if (!request) return null;
  const steps = (await tx.execute(sql`
    select s.step_no as "stepNo", s.decision, s.comment, s.created_at as at, u.full_name as "byName", s.created_by as "byId"
    from approval_step s left join app_user u on u.id = s.created_by where s.request_id = ${requestId} order by s.created_at`)) as unknown as TrailStep[];
  return { request, steps };
}

export type InboxItem = MoneyRequest & {
  branchId: string; branchAr: string; branchEn: string; expenseId: string | null; creditNoteId: string | null;
  categoryAr: string | null; categoryEn: string | null; description: string | null; vendor: string | null; receipt: string | null; isRequest: boolean | null;
  invoiceId: string | null; invoiceNo: string | null; accountNo: string | null; familyName: string | null; creditReason: string | null;
};

/** Money approvals still open (waiting, or waiting for an answer) in the branches this person can see. */
export async function openMoneyRequests(tx: Tx): Promise<InboxItem[]> {
  return (await tx.execute(sql`
    select r.id, r.type, r.status, r.amount_piastres::text as amount, r.current_step as "currentStep", r.step_count as "stepCount",
      r.reason, r.created_by as "requestedBy", u.full_name as "requestedByName", r.created_at as "createdAt", r.decided_at as "decidedAt",
      r.branch_id as "branchId", b.name_ar as "branchAr", b.name_en as "branchEn", r.expense_id as "expenseId", r.credit_note_id as "creditNoteId",
      c.name_ar as "categoryAr", c.name_en as "categoryEn", e.description, v.name as vendor, e.receipt_attachment_id as receipt, e.is_request as "isRequest",
      i.id as "invoiceId", i.invoice_no as "invoiceNo", f.account_no as "accountNo", f.display_name as "familyName", cn.reason as "creditReason"
    from approval_request r
    join branch b on b.id = r.branch_id
    left join app_user u on u.id = r.created_by
    left join expense e on e.id = r.expense_id
    left join expense_category c on c.id = e.category_id
    left join vendor v on v.id = e.vendor_id
    left join credit_note cn on cn.id = r.credit_note_id
    left join invoice i on i.id = cn.invoice_id
    left join family f on f.id = i.family_id
    where r.type in ('expense', 'credit_note', 'refund', 'late_fee_waiver') and r.status in ('pending', 'question')
    order by r.created_at`)) as unknown as InboxItem[];
}


/** Closed cash days of the last week whose difference is above the alert setting (spec §8.5), not yet checked. */
export async function cashVarianceAlerts(tx: Tx, branchId: string, today: string) {
  return (await tx.execute(sql`
    select id, to_char(date, 'YYYY-MM-DD') as date, variance_piastres::text as variance from cash_session
    where branch_id = ${branchId} and closed_at is not null and reconciled_at is null and date >= ${today}::date - 7
      and abs(variance_piastres) > app_setting_bigint(${branchId}, 'cash.variance_alert_piastres', 20000)
    order by date desc`)) as unknown as { id: string; date: string; variance: string }[];
}

export const PAY_STATUS_VIEWS = ["unpaid", "late", "paid", "all"] as const;
export type PayStatusView = (typeof PAY_STATUS_VIEWS)[number];
export type PayStatus = "paid" | "due" | "late" | "not_billed";

/**
 * Which families of a branch have paid (owner, 2026-11-23), with no amounts: the front desk's view.
 * The status comes from app_family_pay_status, which checks the person's role in the branch.
 * "unpaid" = due or late. Late families first, longest late first.
 */
export async function payStatusList(tx: Tx, branchId: string, q: string, view: PayStatusView) {
  const like = `%${q.trim()}%`;
  const statuses = view === "unpaid" ? ["due", "late"] : view === "late" ? ["late"] : view === "paid" ? ["paid"] : ["paid", "due", "late", "not_billed"];
  return (await tx.execute(sql`
    select f.id, f.account_no as "accountNo", f.display_name as "displayName", ps.status, to_char(ps.since, 'YYYY-MM-DD') as since,
      coalesce(string_agg(distinct s.full_name_ar, '، '), '') as "childrenAr",
      coalesce(string_agg(distinct s.full_name_en, ', '), '') as "childrenEn"
    from app_family_pay_status(${branchId}) ps
    join family f on f.id = ps.family_id
    left join student s on s.family_id = f.id and s.status in ('active', 'pending')
    where ps.status in ${sql.raw(`(${statuses.map((x) => `'${x}'`).join(", ")})`)}
      and (${q.trim()} = '' or f.account_no ilike ${like} or f.display_name ilike ${like}
        or exists (select 1 from student c where c.family_id = f.id and (c.full_name_ar ilike ${like} or c.full_name_en ilike ${like})))
    group by f.id, ps.status, ps.since
    order by case ps.status when 'late' then 0 when 'due' then 1 when 'not_billed' then 2 else 3 end, ps.since nulls last, f.account_no`)) as unknown as {
    id: string; accountNo: string; displayName: string; status: PayStatus; since: string | null; childrenAr: string; childrenEn: string;
  }[];
}
