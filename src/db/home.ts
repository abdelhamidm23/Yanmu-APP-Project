import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "./rls";
import { kpis } from "./closing";
import { openMoneyRequests, cashVarianceAlerts } from "./money";
import { reopenRequests } from "./closing";
import { myTurnToDecide, isOwner, canViewMoney, hasRoleIn, FINANCE_VIEW_ROLES } from "@/lib/permissions";
import { expenseRise, occupancyDrop, overdueFamilyFlagged, type AttentionItem } from "@/lib/home";
import { cairoDayStart } from "./money";
import type { Kpi } from "@/lib/data-status";
import type { CurrentUser } from "@/lib/session";

/**
 * What the owner's Home, the figure details and the branch comparison read (spec §9, §11.2–11.4).
 * Every query runs under row-level security as the person viewing, so a branch they hold no role in
 * never appears.
 */

export type HomeBranch = { id: string; nameAr: string; nameEn: string; code: string; licensed: number | null };

const n = (v: unknown) => Number(v ?? 0);
const big = (v: unknown) => BigInt((v as string | number | null) ?? 0);

/** Figures of each branch on a date (app_kpis), keyed by branch. */
export async function kpisByBranch(tx: Tx, branchIds: string[], date: string): Promise<Map<string, Kpi[]>> {
  const out = new Map<string, Kpi[]>();
  for (const id of branchIds) out.set(id, await kpis(tx, id, date));
  return out;
}

/** The latest month every given branch has closed (Verified), or null. */
export async function lastClosedMonth(tx: Tx, branchIds: string[]): Promise<string | null> {
  if (branchIds.length === 0) return null;
  const [r] = (await tx.execute(sql`
    select to_char(month, 'YYYY-MM-DD') as month from period_close
    where status = 'closed' and branch_id in (${sql.join(branchIds.map((b) => sql`${b}::uuid`), sql`, `)})
    group by month having count(distinct branch_id) = ${branchIds.length}
    order by month desc limit 1`)) as unknown as { month: string }[];
  return r?.month ?? null;
}

/** Last day of a month ("2026-10-01" → "2026-10-31"). */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Children waiting for a place, by age group. */
export async function waitlist(tx: Tx, branchId: string) {
  return (await tx.execute(sql`
    select coalesce(a.name_ar, '') as "nameAr", coalesce(a.name_en, '') as "nameEn", count(*)::int as n
    from waitlist_entry w left join age_band a on a.id = w.age_band_id
    where w.branch_id = ${branchId} and w.status = 'waiting'
    group by a.name_ar, a.name_en, a.min_age_months order by a.min_age_months nulls last`)) as unknown as { nameAr: string; nameEn: string; n: number }[];
}

/** Classes with children not marked yet on the date (for the briefing). */
export async function classesNotDone(tx: Tx, branchId: string, date: string) {
  return (await tx.execute(sql`
    select r.name_ar as "nameAr", r.name_en as "nameEn"
    from enrollment e join room r on r.id = e.room_id
    left join student_attendance sa on sa.student_id = e.student_id and sa.date = ${date}::date
    where e.branch_id = ${branchId} and e.start_date <= ${date}::date and (e.end_date is null or e.end_date >= ${date}::date)
      and e.status in ('active', 'withdrawn', 'transferred', 'graduated')
    group by r.id, r.name_ar, r.name_en
    having count(sa.id) < count(*)
    order by r.name_en`)) as unknown as { nameAr: string; nameEn: string }[];
}

/** Working days of the last week not closed, plus today once the alert time has passed (spec §8.9 step 4). */
export async function daysNotClosed(tx: Tx, branchId: string, today: string) {
  return (await tx.execute(sql`
    select to_char(d::date, 'YYYY-MM-DD') as date from generate_series(${today}::date - 7, ${today}::date, interval '1 day') d
    where is_working_day(${branchId}, d::date)
      and not exists (select 1 from daily_close c where c.branch_id = ${branchId} and c.date = d::date)
      and (d::date < ${today}::date or (now() at time zone 'Africa/Cairo')::time >= coalesce(app_setting(${branchId}, 'daily_close.alert_time') #>> '{}', '21:00')::time)
    order by 1`)) as unknown as { date: string }[];
}

export async function isWorking(tx: Tx, branchId: string, date: string): Promise<boolean> {
  const [r] = (await tx.execute(sql`select is_working_day(${branchId}, ${date}::date) as w`)) as unknown as { w: boolean }[];
  return r.w;
}

export async function closeTime(tx: Tx, branchId: string): Promise<string> {
  const [r] = (await tx.execute(sql`select coalesce(app_setting(${branchId}, 'daily_close.due_time') #>> '{}', '19:00') as v`)) as unknown as { v: string }[];
  return r.v;
}

/** Families owing tuition past the due date, longest first (account number, not child names). */
export async function overdueFamilies(tx: Tx, branchId: string, today: string) {
  return (await tx.execute(sql`
    select f.id, f.account_no as "accountNo", f.display_name as "familyName", i.branch_id as "branchId",
      sum(i.total_piastres - i.paid_piastres - i.credited_piastres)::text as amount,
      max(${today}::date - i.due_date)::int as days, count(*)::int as invoices, bool_and(f.is_demo) as "isDemo",
      min(i.due_date) as since
    from invoice i join family f on f.id = i.family_id
    where i.branch_id = ${branchId} and i.kind <> 'late_fee' and i.status not in ('paid', 'void') and i.due_date < ${today}::date
      and i.total_piastres - i.paid_piastres - i.credited_piastres > 0
    group by f.id, f.account_no, f.display_name, i.branch_id
    order by days desc, sum(i.total_piastres - i.paid_piastres - i.credited_piastres) desc`)) as unknown as {
    id: string; accountNo: string; familyName: string; branchId: string; amount: string; days: number; invoices: number; isDemo: boolean; since: string;
  }[];
}

async function settingInt(tx: Tx, branchId: string, key: string, fallback: number): Promise<number> {
  const [r] = (await tx.execute(sql`select app_setting_bigint(${branchId}, ${key}, ${fallback})::text as v`)) as unknown as { v: string | null }[];
  return r?.v == null ? fallback : Number(r.v);
}

/**
 * Everything that "Requires your attention" (spec §9.6) for this person in these branches, unranked.
 * Money rows only for those who see money; decisions only when it is this person's turn.
 */
export async function attentionItems(tx: Tx, user: CurrentUser, branches: HomeBranch[], today: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const ids = new Set(branches.map((b) => b.id));
  const now = new Date().toISOString();

  // 1. Open critical incidents.
  const critical = (await tx.execute(sql`
    select id, branch_id as "branchId", category, occurred_at as at from incident
    where severity = 'critical' and status <> 'closed'`)) as unknown as { id: string; branchId: string; category: string; at: Date }[];
  for (const c of critical.filter((c) => ids.has(c.branchId)))
    items.push({ kind: "critical_incident", id: c.id, branchId: c.branchId, at: new Date(c.at).toISOString(), href: `/incidents/${c.id}`, values: { category: c.category } });

  // 2. Decisions waiting for this person: money approvals, months to reopen, children over the licence cap.
  if (canViewMoney(user)) {
    for (const r of (await openMoneyRequests(tx)).filter((r) => ids.has(r.branchId) && myTurnToDecide(user, r))) {
      items.push({
        kind: "approval", id: r.id, branchId: r.branchId, at: new Date(r.createdAt).toISOString(),
        href: `/inbox#r-${r.id}`, values: { type: r.type, amount: BigInt(r.amount ?? "0") },
      });
    }
  }
  if (isOwner(user)) {
    for (const r of (await reopenRequests(tx)).filter((r) => ids.has(r.branchId) && r.requestedById !== user.id))
      items.push({ kind: "reopen", id: r.id, branchId: r.branchId, at: new Date(r.requestedAt).toISOString(), href: `/month-close?branch=${r.branchId}&month=${r.month.slice(0, 7)}`, values: { month: r.month } });
    const cap = (await tx.execute(sql`
      select id, branch_id as "branchId", created_at as at, created_by as "by" from approval_request
      where type = 'over_capacity' and status = 'pending'`)) as unknown as { id: string; branchId: string; at: Date; by: string | null }[];
    for (const r of cap.filter((r) => ids.has(r.branchId) && r.by !== user.id))
      items.push({ kind: "over_capacity", id: r.id, branchId: r.branchId, at: new Date(r.at).toISOString(), href: "/children/approvals", values: {} });
  }

  for (const b of branches) {
    const money = hasRoleIn(user, FINANCE_VIEW_ROLES, b.id);
    // 3. Families overdue more than 60 days or owing more than EGP 15,000 (settings).
    if (money) {
      const limits = {
        days: await settingInt(tx, b.id, "attention.overdue_days", 60),
        amount: BigInt(await settingInt(tx, b.id, "attention.overdue_amount_piastres", 1_500_000)),
      };
      for (const f of await overdueFamilies(tx, b.id, today)) {
        if (!overdueFamilyFlagged({ days: f.days, amount: BigInt(f.amount) }, limits)) continue;
        items.push({
          kind: "overdue_family", id: f.id, branchId: b.id, at: `${f.since}T00:00:00.000Z`,
          href: `/invoices?branch=${b.id}&view=overdue&q=${encodeURIComponent(f.accountNo)}`,
          values: { account: f.accountNo, family: f.familyName, amount: BigInt(f.amount), days: f.days, invoices: f.invoices },
        });
      }
    }

    // 4. Classes below the staff ratio today; days not closed.
    const breaches = (await tx.execute(sql`
      select r.name_ar as "nameAr", r.name_en as "nameEn", min(s.taken_at) as at
      from ratio_snapshot s join room r on r.id = s.room_id
      where s.branch_id = ${b.id} and s.is_breach and s.taken_at >= ${cairoDayStart(today).toISOString()}
      group by r.id, r.name_ar, r.name_en order by at`)) as unknown as { nameAr: string; nameEn: string; at: Date }[];
    if (breaches.length)
      items.push({
        kind: "ratio_breach", id: `${b.id}:${today}`, branchId: b.id, at: new Date(breaches[0].at).toISOString(),
        href: `/home/ratio_breaches?branch=${b.id}`, values: { count: breaches.length, classesAr: breaches.map((x) => x.nameAr).join("، "), classesEn: breaches.map((x) => x.nameEn).join(", ") },
      });
    for (const d of await daysNotClosed(tx, b.id, today))
      items.push({ kind: "close_missing", id: `${b.id}:${d.date}`, branchId: b.id, at: `${d.date}T19:00:00.000Z`, href: `/daily-close?branch=${b.id}&date=${d.date}`, values: { date: d.date } });

    // 5. Expense categories 20% above their 3-month average this month (once there are 3 months of history).
    if (money) {
      const pct = await settingInt(tx, b.id, "attention.expense_rise_percent", 20);
      const rows = (await tx.execute(sql`
        with m as (select date_trunc('month', ${today}::date)::date as start)
        select c.id, c.name_ar as "nameAr", c.name_en as "nameEn",
          coalesce(sum(e.amount_piastres) filter (where e.spent_on >= m.start and e.spent_on <= ${today}::date), 0)::text as mtd,
          coalesce(sum(e.amount_piastres) filter (where e.spent_on >= m.start - interval '3 months' and e.spent_on < m.start), 0)::text as prev,
          min(e.spent_on) <= (m.start - interval '3 months')::date + 6 as history
        from expense e join expense_category c on c.id = e.category_id, m
        where e.branch_id = ${b.id} and not e.is_request and e.status in ('recorded', 'approved', 'reversed')
        group by c.id, c.name_ar, c.name_en, m.start`)) as unknown as { id: string; nameAr: string; nameEn: string; mtd: string; prev: string; history: boolean }[];
      for (const r of rows)
        if (r.history && expenseRise(BigInt(r.mtd), BigInt(r.prev), pct))
          items.push({
            kind: "expense_rise", id: `${b.id}:${r.id}`, branchId: b.id, at: `${today.slice(0, 8)}01T00:00:00.000Z`,
            href: `/expenses?branch=${b.id}`, values: { categoryAr: r.nameAr, categoryEn: r.nameEn, amount: BigInt(r.mtd), average: BigInt(r.prev) / 3n, percent: pct },
          });
    }

    // 6. Occupancy down 5 points or more since the same day last month.
    const points = await settingInt(tx, b.id, "attention.occupancy_drop_points", 5);
    const [occ] = (await tx.execute(sql`
      select
        (select count(*) from enrollment e where e.branch_id = ${b.id} and e.start_date <= ${today}::date and (e.end_date is null or e.end_date >= ${today}::date)
           and e.status in ('active', 'withdrawn', 'transferred', 'graduated'))::int as now,
        (select count(*) from enrollment e where e.branch_id = ${b.id} and e.start_date <= (${today}::date - interval '1 month')::date
           and (e.end_date is null or e.end_date >= (${today}::date - interval '1 month')::date)
           and e.status in ('active', 'withdrawn', 'transferred', 'graduated'))::int as before`)) as unknown as { now: number; before: number }[];
    const licensed = b.licensed ?? 0;
    if (occupancyDrop(occ.before, occ.now, licensed, points))
      items.push({
        kind: "occupancy_drop", id: `${b.id}:${today.slice(0, 7)}`, branchId: b.id, at: now,
        href: `/children?branch=${b.id}`, values: { before: occ.before, now: occ.now, licensed },
      });

    // 7. Cash box differences above the alert setting, not yet checked.
    if (money)
      for (const c of await cashVarianceAlerts(tx, b.id, today))
        items.push({ kind: "cash_variance", id: c.id, branchId: b.id, at: `${c.date}T18:00:00.000Z`, href: `/cash-box?branch=${b.id}`, values: { amount: BigInt(c.variance), date: c.date } });
  }
  return items;
}

/** Ageing of overdue tuition per branch (spec §11.3). */
export async function overdueAgeing(tx: Tx, branchId: string, today: string) {
  const [r] = (await tx.execute(sql`
    with o as (
      select family_id, ${today}::date - due_date as days, total_piastres - paid_piastres - credited_piastres as bal
      from invoice where branch_id = ${branchId} and kind <> 'late_fee' and status not in ('paid', 'void') and due_date < ${today}::date
    )
    select
      coalesce(sum(bal) filter (where bal > 0 and days <= 30), 0)::text as b1, count(distinct family_id) filter (where bal > 0 and days <= 30)::int as f1,
      coalesce(sum(bal) filter (where bal > 0 and days between 31 and 60), 0)::text as b2, count(distinct family_id) filter (where bal > 0 and days between 31 and 60)::int as f2,
      coalesce(sum(bal) filter (where bal > 0 and days > 60), 0)::text as b3, count(distinct family_id) filter (where bal > 0 and days > 60)::int as f3
    from o`)) as unknown as Record<string, string | number>[];
  return [
    { key: "d1_30", amount: big(r.b1), families: n(r.f1) },
    { key: "d31_60", amount: big(r.b2), families: n(r.f2) },
    { key: "d60_plus", amount: big(r.b3), families: n(r.f3) },
  ] as const;
}

/** Costs paid centrally for a branch and month, from the month-close template (null before the upload). */
export async function centralCosts(tx: Tx, branchId: string, month: string) {
  const [r] = (await tx.execute(sql`
    select count(*)::int as lines, coalesce(sum(l.amount_piastres), 0)::text as total,
      sum(l.amount_piastres) filter (where l.line_key = 'central:salaries')::text as salaries
    from period_import_line l join period_close pc on pc.id = l.period_close_id
    where pc.branch_id = ${branchId} and pc.month = ${month}::date and l.kind = 'central'`)) as unknown as { lines: number; total: string; salaries: string | null }[];
  return r.lines === 0 ? { central: null, salaries: null } : { central: BigInt(r.total), salaries: r.salaries === null ? null : BigInt(r.salaries) };
}

/** The first month with records of each kind, so a trend never shows months before the app was used as zeros. */
export async function firstMonths(tx: Tx, branchIds: string[]) {
  const ids = sql.join(branchIds.map((b) => sql`${b}::uuid`), sql`, `);
  const [r] = (await tx.execute(sql`
    select
      to_char(date_trunc('month', (select min(service_month) from invoice where branch_id in (${ids}))), 'YYYY-MM-DD') as money,
      to_char(date_trunc('month', (select min(start_date) from enrollment where branch_id in (${ids}))), 'YYYY-MM-DD') as children,
      to_char(date_trunc('month', least((select min(date) from student_attendance where branch_id in (${ids})), (select min(date) from daily_close where branch_id in (${ids})),
        (select min(occurred_at at time zone 'Africa/Cairo')::date from incident where branch_id in (${ids})))), 'YYYY-MM-DD') as operations`)) as unknown as {
    money: string | null; children: string | null; operations: string | null;
  }[];
  return r;
}

/** The app's own expenses of a month for a branch (recorded and approved; reversals net out). */
export async function appExpenses(tx: Tx, branchId: string, month: string, until: string): Promise<bigint> {
  const [r] = (await tx.execute(sql`
    select coalesce(sum(amount_piastres), 0)::text as v from expense
    where branch_id = ${branchId} and not is_request and status in ('recorded', 'approved', 'reversed')
      and spent_on >= ${month}::date and spent_on < (${month}::date + interval '1 month') and spent_on <= ${until}::date`)) as unknown as { v: string }[];
  return BigInt(r.v);
}

/** Families over the "call them" limits (settings attention.overdue_days / overdue_amount_piastres). */
export async function flaggedFamilies(tx: Tx, branchId: string, today: string) {
  const limits = {
    days: await settingInt(tx, branchId, "attention.overdue_days", 60),
    amount: BigInt(await settingInt(tx, branchId, "attention.overdue_amount_piastres", 1_500_000)),
  };
  return (await overdueFamilies(tx, branchId, today)).filter((f) => overdueFamilyFlagged({ days: f.days, amount: BigInt(f.amount) }, limits));
}

export async function callLimits(tx: Tx, branchId: string) {
  return {
    days: await settingInt(tx, branchId, "attention.overdue_days", 60),
    amount: BigInt(await settingInt(tx, branchId, "attention.overdue_amount_piastres", 1_500_000)),
  };
}

/** Attendance per class on a date (the records behind "Attendance today"). */
export async function classAttendance(tx: Tx, branchId: string, date: string) {
  return (await tx.execute(sql`
    select r.id, r.name_ar as "nameAr", r.name_en as "nameEn", count(*)::int as children, count(sa.id)::int as marked,
      count(*) filter (where sa.status = 'present')::int as present,
      count(*) filter (where sa.status in ('present', 'absent'))::int as expected
    from enrollment e join room r on r.id = e.room_id
    left join student_attendance sa on sa.student_id = e.student_id and sa.date = ${date}::date
    where e.branch_id = ${branchId} and e.start_date <= ${date}::date and (e.end_date is null or e.end_date >= ${date}::date)
      and e.status in ('active', 'withdrawn', 'transferred', 'graduated')
    group by r.id, r.name_ar, r.name_en order by r.name_en`)) as unknown as {
    id: string; nameAr: string; nameEn: string; children: number; marked: number; present: number; expected: number;
  }[];
}

/** Ratio snapshots below the requirement on a date, latest per class. */
export async function breachesOn(tx: Tx, branchId: string, date: string) {
  const from = cairoDayStart(date);
  const to = new Date(from.getTime() + 86_400_000);
  return (await tx.execute(sql`
    select distinct on (s.room_id) r.name_ar as "nameAr", r.name_en as "nameEn", s.taken_at as at,
      s.children_present as children, s.carers_present as carers, s.required_carers as required
    from ratio_snapshot s join room r on r.id = s.room_id
    where s.branch_id = ${branchId} and s.is_breach and s.taken_at >= ${from.toISOString()} and s.taken_at < ${to.toISOString()}
    order by s.room_id, s.taken_at desc`)) as unknown as { nameAr: string; nameEn: string; at: Date; children: number; carers: number; required: number }[];
}
