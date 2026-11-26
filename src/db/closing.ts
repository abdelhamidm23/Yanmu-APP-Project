import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "./rls";
import { fromRow, type Kpi, type KpiRow } from "@/lib/data-status";
import { DAILY_CLOSE_SECTIONS } from "./schema";

/** Daily close, month close and figures (spec §8.9, §8.10, §9). The database decides who sees what. */

export type DaySection = (typeof DAILY_CLOSE_SECTIONS)[number];

/** What each section of the day shows: counts only, no amounts and no names (app_day_facts). */
export type DayFacts = {
  attendance: { classes: number; classesDone: number; present: number; absent: number; excused: number; notMarked: number };
  pickups: { checkedOut: number; stillIn: number; refusals: number };
  staff: { uploaded: boolean; present: number; late: number; absent: number; staff: number };
  payments: { count: number; voided: number; cashBox: "open" | "closed" | "none" };
  expenses: { count: number; waiting: number };
  incidents: { count: number; critical: number; open: number };
  issues: { new: number; resolved: number; open: number; overdue: number };
};

export async function dayFacts(tx: Tx, branchId: string, date: string): Promise<DayFacts> {
  const [r] = (await tx.execute(sql`select app_day_facts(${branchId}, ${date}::date) as f`)) as unknown as { f: DayFacts }[];
  return r.f;
}

/** Sections with nothing to confirm ask "Yes, none" (a confirmed zero, spec §8.9 step 2). */
export function emptySection(s: DaySection, f: DayFacts): boolean {
  switch (s) {
    case "attendance":
      return f.attendance.present + f.attendance.absent + f.attendance.excused === 0;
    case "pickups":
      return f.pickups.checkedOut + f.pickups.stillIn + f.pickups.refusals === 0;
    case "staff":
      return !f.staff.uploaded;
    case "payments":
      return f.payments.count + f.payments.voided === 0;
    case "expenses":
      return f.expenses.count === 0;
    case "incidents":
      return f.incidents.count === 0;
    case "issues":
      return f.issues.new + f.issues.resolved === 0;
  }
}

export type SectionState = { state: "correct" | "fix" | "none"; note?: string; facts?: unknown };

export type DailyCloseRow = {
  id: string; branchId: string; date: string; sections: Record<DaySection, SectionState>; notes: string | null;
  closedBy: string | null; closedAt: Date; isLate: boolean; isDemo: boolean;
};

export async function dailyClose(tx: Tx, branchId: string, date: string): Promise<DailyCloseRow | null> {
  const [r] = (await tx.execute(sql`
    select d.id, d.branch_id as "branchId", to_char(d.date, 'YYYY-MM-DD') as date, d.sections, d.notes, u.full_name as "closedBy",
      d.closed_at as "closedAt", d.is_late as "isLate", d.is_demo as "isDemo"
    from daily_close d left join app_user u on u.id = d.closed_by
    where d.branch_id = ${branchId} and d.date = ${date}::date`)) as unknown as DailyCloseRow[];
  return r ?? null;
}

/** The last working days of a branch and whether each was closed (newest first). */
export async function recentDays(tx: Tx, branchId: string, until: string, days = 21) {
  return (await tx.execute(sql`
    select to_char(d::date, 'YYYY-MM-DD') as date, c.id is not null as closed, c.is_late as late, u.full_name as "closedBy", c.closed_at as "closedAt"
    from generate_series(${until}::date - ${days}::int, ${until}::date, interval '1 day') d
    left join daily_close c on c.branch_id = ${branchId} and c.date = d::date
    left join app_user u on u.id = c.closed_by
    where is_working_day(${branchId}, d::date)
    order by d desc`)) as unknown as { date: string; closed: boolean; late: boolean | null; closedBy: string | null; closedAt: Date | null }[];
}

export async function kpis(tx: Tx, branchId: string, date: string): Promise<Kpi[]> {
  const rows = (await tx.execute(sql`
    select key, value::text as value, num::text as num, den::text as den, status, done, total from app_kpis(${branchId}, ${date}::date)`)) as unknown as KpiRow[];
  return rows.map(fromRow);
}

// ---------------------------------------------------------------------------
// Month close
// ---------------------------------------------------------------------------

export type PeriodRow = {
  id: string; branchId: string; month: string; status: "open" | "closed"; closedBy: string | null; closedAt: Date | null;
  reopenRequestedBy: string | null; reopenRequestedById: string | null; reopenRequestedAt: Date | null; reopenReason: string | null;
  reopenedBy: string | null; reopenedAt: Date | null;
};

/** The period of a branch and month (made on first use). */
export async function period(tx: Tx, branchId: string, month: string): Promise<PeriodRow> {
  const [{ id }] = (await tx.execute(sql`select app_period(${branchId}, ${month}::date) as id`)) as unknown as { id: string }[];
  const [p] = (await tx.execute(sql`
    select p.id, p.branch_id as "branchId", to_char(p.month, 'YYYY-MM-DD') as month, p.status, cu.full_name as "closedBy", p.closed_at as "closedAt",
      ru.full_name as "reopenRequestedBy", p.reopen_requested_by as "reopenRequestedById", p.reopen_requested_at as "reopenRequestedAt",
      p.reopen_reason as "reopenReason", ou.full_name as "reopenedBy", p.reopened_at as "reopenedAt"
    from period_close p
    left join app_user cu on cu.id = p.closed_by
    left join app_user ru on ru.id = p.reopen_requested_by
    left join app_user ou on ou.id = p.reopened_by
    where p.id = ${id}`)) as unknown as PeriodRow[];
  return p;
}

/** Closed months waiting for the owner's decision to reopen. */
export async function reopenRequests(tx: Tx) {
  return (await tx.execute(sql`
    select p.id, p.branch_id as "branchId", to_char(p.month, 'YYYY-MM-DD') as month, b.name_ar as "branchAr", b.name_en as "branchEn",
      u.full_name as "requestedBy", p.reopen_requested_by as "requestedById", p.reopen_reason as reason, p.reopen_requested_at as "requestedAt"
    from period_close p join branch b on b.id = p.branch_id left join app_user u on u.id = p.reopen_requested_by
    where p.status = 'closed' and p.reopen_requested_at is not null
    order by p.reopen_requested_at`)) as unknown as {
    id: string; branchId: string; month: string; branchAr: string; branchEn: string; requestedBy: string | null; requestedById: string;
    reason: string; requestedAt: Date;
  }[];
}

export type PeriodLine = {
  id: string; kind: "check" | "central" | "balance"; lineKey: string; appPiastres: string | null; amountPiastres: string; note: string | null;
  batchId: string;
};

export async function periodLines(tx: Tx, periodId: string): Promise<PeriodLine[]> {
  return (await tx.execute(sql`
    select l.id, l.kind, l.line_key as "lineKey", l.app_piastres::text as "appPiastres", l.amount_piastres::text as "amountPiastres", l.note,
      l.batch_id as "batchId"
    from period_import_line l where l.period_close_id = ${periodId} order by l.kind, l.line_key`)) as unknown as PeriodLine[];
}

/** Month-close uploads of a branch and month: their file names start with the month (YYYY-MM). */
export async function periodBatches(tx: Tx, branchId: string, month: string) {
  return (await tx.execute(sql`
    select b.id, b.file_name as "fileName", b.row_count as "rowCount", b.status, b.created_at as "createdAt", u.full_name as "by"
    from import_batch b left join app_user u on u.id = b.created_by
    where b.branch_id = ${branchId} and b.kind = 'month_close' and b.file_name like ${`${month.slice(0, 7)} %`}
    order by b.created_at desc`)) as unknown as { id: string; fileName: string; rowCount: number; status: string; createdAt: Date; by: string | null }[];
}

/**
 * The app's own figures for a month, as the template pre-fills them (spec §8.10): revenue billed (tuition and
 * services, net of credit notes), late fees charged on the month's days, payments received, and expenses by category.
 */
export async function monthAppFigures(tx: Tx, branchId: string, month: string) {
  const [totals] = (await tx.execute(sql`
    select
      (select coalesce(sum(i.total_piastres - i.credited_piastres), 0) from invoice i
        where i.branch_id = ${branchId} and i.service_month = ${month}::date and i.kind <> 'late_fee' and i.status <> 'void')::text as billed,
      (select coalesce(sum(l.amount_piastres), 0) from invoice_line l join invoice i on i.id = l.invoice_id
        where l.branch_id = ${branchId} and i.kind = 'late_fee' and i.status <> 'void' and l.item_type = 'late_fee'
          and l.accrual_date >= ${month}::date and l.accrual_date < (${month}::date + interval '1 month'))::text as "lateFees",
      (select coalesce(sum(p.amount_piastres), 0) from payment p
        where p.branch_id = ${branchId} and p.voided_at is null
          and (p.received_at at time zone 'Africa/Cairo')::date >= ${month}::date
          and (p.received_at at time zone 'Africa/Cairo')::date < (${month}::date + interval '1 month'))::text as collected`)) as unknown as {
    billed: string; lateFees: string; collected: string;
  }[];
  const expenses = (await tx.execute(sql`
    select c.id, c.key, c.name_ar as "nameAr", c.name_en as "nameEn",
      coalesce(sum(e.amount_piastres) filter (where e.id is not null), 0)::text as amount
    from expense_category c
    left join expense e on e.category_id = c.id and e.branch_id = ${branchId} and not e.is_request
      and e.status in ('recorded', 'approved', 'reversed') and e.spent_on >= ${month}::date and e.spent_on < (${month}::date + interval '1 month')
    group by c.id order by c.sort, c.key`)) as unknown as { id: string; key: string; nameAr: string; nameEn: string; amount: string }[];
  return { ...totals, expenses };
}
