/**
 * Demo closing (spec §16), called by `pnpm seed:demo`: daily closes for the working days since the
 * start of last month (Yanmu closed every day; Norvale missed its last working day, closed one day
 * late and flagged one section to fix), and the month before last closed by the accountant with a
 * month-close template (central costs, balances, one explained difference), so its figures are Verified.
 * Last month stays open for trying the month close. Everything is flagged is_demo.
 * Safe to run again: it only adds what is missing.
 */
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { cairoWallToUtc, todayInCairo } from "../src/lib/calendar";
import { shiftMonth, monthStart } from "../src/lib/billing";

type Db = PostgresJsDatabase<typeof schema>;
type Facts = Record<string, Record<string, number | boolean | string>>;

const EGP = (v: number) => BigInt(Math.round(v * 100));
/** Costs paid centrally, per month (made up, in EGP). */
const CENTRAL: Record<"A" | "B", Record<string, number>> = {
  A: { salaries: 214500, rent: 60000, security: 12000, utilities: 9800, marketing: 7500, admin: 4200 },
  B: { salaries: 151000, rent: 45000, security: 9000, utilities: 7300, marketing: 5000, admin: 3100 },
};
const BALANCES: Record<"A" | "B", [number, number]> = { A: [18450, 386200.5], B: [11200, 214980] };

function empty(s: string, f: Facts): boolean {
  const n = (k: string) => Number(f[s]?.[k] ?? 0);
  switch (s) {
    case "attendance": return n("present") + n("absent") + n("excused") === 0;
    case "pickups": return n("checkedOut") + n("stillIn") + n("refusals") === 0;
    case "staff": return !f.staff?.uploaded;
    case "payments": return n("count") + n("voided") === 0;
    case "expenses": return n("count") === 0;
    case "incidents": return n("count") === 0;
    default: return n("new") + n("resolved") === 0;
  }
}

async function userWith(db: Db, role: string, branchId: string): Promise<string | null> {
  const [r] = (await db.execute(sql`
    select user_id as id from user_branch_role where role = ${role} and (branch_id = ${branchId} or branch_id is null)
    order by branch_id nulls last limit 1`)) as unknown as { id: string }[];
  return r?.id ?? null;
}

export async function seedDemoClosing(db: Db) {
  const today = todayInCairo();
  const from = shiftMonth(monthStart(today), -1);
  const closedMonth = shiftMonth(monthStart(today), -2);
  const branches = await db.select().from(schema.branch).where(eq(schema.branch.isActive, true));
  let days = 0;
  let months = 0;
  for (const b of branches) {
    const code = b.code as "A" | "B";
    if (code !== "A" && code !== "B") continue;
    const bm = await userWith(db, "branch_manager", b.id);
    const dates = ((await db.execute(sql`
      select to_char(d::date, 'YYYY-MM-DD') as d from generate_series(${from}::date, ${today}::date - 1, interval '1 day') d
      where is_working_day(${b.id}, d::date) order by d`)) as unknown as { d: string }[]).map((r) => r.d);
    // Norvale has not closed its last working day yet; one of its days was closed the next morning.
    const skip = code === "B" ? dates.at(-1) : undefined;
    const late = code === "B" ? dates.at(-6) : undefined;
    const fix = code === "B" ? dates.at(-4) : undefined;
    for (const d of dates) {
      if (d === skip) continue;
      const [f] = (await db.execute(sql`select app_day_facts(${b.id}, ${d}::date) as f`)) as unknown as { f: Facts }[];
      const sections = Object.fromEntries(
        schema.DAILY_CLOSE_SECTIONS.map((s) => [
          s,
          d === fix && s === "staff"
            ? { state: "fix", note: "Fingerprint machine missed two morning punches; HR to correct.", facts: f.f[s] }
            : { state: empty(s, f.f) ? "none" : "correct", facts: f.f[s] },
        ]),
      );
      const [y, m, day] = d.split("-").map(Number);
      const closedAt = d === late ? cairoWallToUtc(y, m, day + 1, 9, 20) : cairoWallToUtc(y, m, day, 17, 20 + (day % 25));
      const r = await db
        .insert(schema.dailyClose)
        .values({ branchId: b.id, date: d, sections, closedBy: bm, closedAt, isDemo: true, notes: d === late ? "Closed in the morning: the branch manager was at the clinic with a child's guardian." : null })
        .onConflictDoNothing()
        .returning({ id: schema.dailyClose.id });
      days += r.length;
    }

    // The month before last: template uploaded and month closed by the accountant on the 5th.
    const [{ id: periodId }] = (await db.execute(sql`select app_period(${b.id}, ${closedMonth}::date) as id`)) as unknown as { id: string }[];
    await db.update(schema.periodClose).set({ isDemo: true }).where(eq(schema.periodClose.id, periodId));
    const [p] = await db.select().from(schema.periodClose).where(eq(schema.periodClose.id, periodId));
    if (p.status === "closed") continue;
    const accountant = await userWith(db, "accountant", b.id);
    const [fig] = (await db.execute(sql`
      select
        (select coalesce(sum(i.total_piastres - i.credited_piastres), 0) from invoice i
          where i.branch_id = ${b.id} and i.service_month = ${closedMonth}::date and i.kind <> 'late_fee' and i.status <> 'void')::text as billed,
        (select coalesce(sum(l.amount_piastres), 0) from invoice_line l join invoice i on i.id = l.invoice_id
          where l.branch_id = ${b.id} and i.kind = 'late_fee' and i.status <> 'void' and l.item_type = 'late_fee'
            and l.accrual_date >= ${closedMonth}::date and l.accrual_date < (${closedMonth}::date + interval '1 month'))::text as late,
        (select coalesce(sum(p.amount_piastres), 0) from payment p
          where p.branch_id = ${b.id} and p.voided_at is null
            and (p.received_at at time zone 'Africa/Cairo')::date >= ${closedMonth}::date
            and (p.received_at at time zone 'Africa/Cairo')::date < (${closedMonth}::date + interval '1 month'))::text as collected`)) as unknown as {
      billed: string; late: string; collected: string;
    }[];
    const cats = (await db.execute(sql`
      select c.id, c.key, coalesce(sum(e.amount_piastres) filter (where e.id is not null), 0)::text as amount
      from expense_category c
      left join expense e on e.category_id = c.id and e.branch_id = ${b.id} and not e.is_request
        and e.status in ('recorded', 'approved', 'reversed') and e.spent_on >= ${closedMonth}::date and e.spent_on < (${closedMonth}::date + interval '1 month')
      group by c.id`)) as unknown as { id: string; key: string; amount: string }[];
    const [batch] = await db
      .insert(schema.importBatch)
      .values({ branchId: b.id, kind: "month_close", fileName: `${closedMonth.slice(0, 7)} month-close ${code} (demo).xlsx`, rowCount: 0, createdBy: accountant })
      .returning({ id: schema.importBatch.id });
    const collected = BigInt(fig.collected);
    const lines: (typeof schema.periodImportLine.$inferInsert)[] = [
      { kind: "check", lineKey: "check:billed", appPiastres: BigInt(fig.billed), amountPiastres: BigInt(fig.billed) },
      { kind: "check", lineKey: "check:late_fees", appPiastres: BigInt(fig.late), amountPiastres: BigInt(fig.late) },
      {
        kind: "check", lineKey: "check:collected", appPiastres: collected, amountPiastres: code === "A" ? collected - EGP(1850) : collected,
        note: code === "A" ? "One InstaPay payment of EGP 1,850 reached the bank on the 1st of the next month." : null,
      },
      ...cats.filter((c) => BigInt(c.amount) !== 0n).map((c) => ({ kind: "check", lineKey: `check:expense:${c.key}`, categoryId: c.id, appPiastres: BigInt(c.amount), amountPiastres: BigInt(c.amount) })),
      ...Object.entries(CENTRAL[code]).map(([k, v]) => ({ kind: "central", lineKey: `central:${k}`, categoryId: cats.find((c) => c.key === k)?.id ?? null, amountPiastres: EGP(v) })),
      { kind: "balance", lineKey: "balance:cash", amountPiastres: EGP(BALANCES[code][0]) },
      { kind: "balance", lineKey: "balance:bank", amountPiastres: EGP(BALANCES[code][1]) },
    ].map((l) => ({ ...l, periodCloseId: periodId, branchId: b.id, batchId: batch.id, isDemo: true, createdBy: accountant }));
    await db.insert(schema.periodImportLine).values(lines);
    await db.update(schema.importBatch).set({ rowCount: lines.length }).where(eq(schema.importBatch.id, batch.id));
    await db.insert(schema.balanceSnapshot).values({ branchId: b.id, month: closedMonth, batchId: batch.id, cashPiastres: EGP(BALANCES[code][0]), bankPiastres: EGP(BALANCES[code][1]), isDemo: true });
    const [cy, cm] = shiftMonth(closedMonth, 1).split("-").map(Number);
    await db
      .update(schema.periodClose)
      .set({ status: "closed", closedBy: accountant, closedAt: cairoWallToUtc(cy, cm, 5, 11, 40) })
      .where(and(eq(schema.periodClose.id, periodId), eq(schema.periodClose.status, "open")));
    months++;
  }
  // The figures of the last week, as the nightly job would have kept them.
  for (let i = 7; i >= 1; i--) await db.execute(sql`select app_snapshot_kpis(${today}::date - ${i}::int)`);
  return `Demo closing: ${days} daily closes added, ${months} months closed (${closedMonth.slice(0, 7)}).`;
}
