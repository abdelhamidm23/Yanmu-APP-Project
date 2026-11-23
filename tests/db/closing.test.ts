/**
 * Phase 6 database rules (spec §8.9, §8.10, §6.1, §9): daily closes and month closes stay in their
 * branch; a day needs every section answered and a note on "to fix"; the accountant closes a month only
 * after it ends, with its template and a note on each difference; a closed month is locked; reopening
 * needs the owner; money figures are only for the owner, company manager and accountant.
 * Run with `pnpm test:db` against a migrated, seeded database.
 */
import "dotenv/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/lib/roles";

const owner = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 2, onnotice: () => {} });
const app = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });

type Sql = postgres.TransactionSql;
const run = `closing-${Date.now()}`;
const code = `C${Date.now().toString(36).toUpperCase()}`;
let branchA: string;
let branchB: string;
let familyA: string;
let studentA: string;
let today: string;
let lastMonth: string;
const u: Record<string, string> = {};

async function makeUser(label: string, grants: [Role, string | null][]) {
  const [x] = await owner`insert into app_user (full_name, email) values (${label}, ${`${label}.${run}@test.invalid`}) returning id`;
  for (const [role, branch] of grants) await owner`insert into user_branch_role (user_id, branch_id, role) values (${x.id}, ${branch}, ${role})`;
  return x.id as string;
}

async function as<T>(userId: string | null, fn: (tx: Sql) => Promise<T>): Promise<T> {
  let result: T;
  const rollback = new Error("rollback");
  try {
    await app.begin(async (tx) => {
      if (userId) await tx`select set_config('app.user_id', ${userId}, true)`;
      result = await fn(tx);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  return result!;
}

async function expectError(tx: Sql, statement: (sp: Sql) => Promise<unknown>, match: Record<string, string>) {
  await expect(tx.savepoint((sp) => statement(sp))).rejects.toMatchObject(match);
}
const denied = { code: "42501" };

const SECTIONS = ["attendance", "pickups", "staff", "payments", "expenses", "incidents", "issues"];
const sections = (over: Record<string, unknown> = {}) => ({ ...Object.fromEntries(SECTIONS.map((s) => [s, { state: "correct" }])), ...over });
const close = (tx: Sql, branch: string, date: string, s: Record<string, unknown> = sections()) =>
  tx`insert into daily_close (branch_id, date, sections) values (${branch}, ${date}, ${tx.json(s as never)}) returning id, closed_by, is_late`;

beforeAll(async () => {
  const [{ id: orgId }] = await owner`select id from organization limit 1`;
  [{ id: branchA }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'أ', 'Closing A', ${code + "A"}) returning id`;
  [{ id: branchB }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'ب', 'Closing B', ${code + "B"}) returning id`;
  [{ id: familyA }] = await owner`insert into family (branch_id, account_no, display_name) values (${branchA}, ${run}, 'Fam') returning id`;
  [{ id: studentA }] = await owner`
    insert into student (branch_id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id)
    values (${branchA}, ${run}, 'طفل', 'Child A', '2025-03-01', 'male', ${familyA}) returning id`;
  [{ today, lastMonth }] = await owner`select to_char(app_cairo_today(), 'YYYY-MM-DD') as today,
    to_char(date_trunc('month', app_cairo_today()) - interval '1 month', 'YYYY-MM-DD') as "lastMonth"`;
  u.bmA = await makeUser("bmA", [["branch_manager", branchA]]);
  u.bmB = await makeUser("bmB", [["branch_manager", branchB]]);
  u.teacherA = await makeUser("teacherA", [["teacher", branchA]]);
  u.frontA = await makeUser("frontA", [["front_desk", branchA]]);
  u.accA = await makeUser("accA", [["accountant", branchA]]);
  u.owner = await makeUser("owner", [["owner", null]]);
  u.cm = await makeUser("cm", [["company_manager", null]]);
});

afterAll(async () => {
  await owner`update period_close set status = 'open' where branch_id in (${branchA}, ${branchB})`;
  await owner`delete from balance_snapshot where branch_id in (${branchA}, ${branchB})`;
  await owner`delete from period_import_line where branch_id in (${branchA}, ${branchB})`;
  await owner.end();
  await app.end();
});

describe("daily close (spec §8.9)", () => {
  it("only the branch's own manager (or the company manager) closes its day, and only its viewers see it", async () => {
    await as(u.bmA, async (tx) => {
      const [c] = await close(tx, branchA, today);
      expect(c.closed_by).toBe(u.bmA);
      await expectError(tx, (sp) => close(sp, branchB, today), denied);
    });
    for (const who of [u.teacherA, u.frontA, u.accA]) await as(who, (tx) => expectError(tx, (sp) => close(sp, branchA, today), denied));
    await as(u.cm, (tx) => close(tx, branchB, today));
    await owner`insert into daily_close (branch_id, date, sections) values (${branchA}, ${today}, ${owner.json(sections() as never)})`;
    expect(await as(u.bmB, (tx) => tx`select id from daily_close where branch_id = ${branchA}`)).toHaveLength(0);
    expect(await as(u.teacherA, (tx) => tx`select id from daily_close where branch_id = ${branchA}`)).toHaveLength(0);
    expect(await as(u.accA, (tx) => tx`select id from daily_close where branch_id = ${branchA}`)).toHaveLength(1);
    expect(await as(u.owner, (tx) => tx`select id from daily_close where branch_id = ${branchA}`)).toHaveLength(1);
    // Once closed it stays closed: no edits, no deletes.
    await as(u.bmA, async (tx) => {
      expect(await tx`update daily_close set notes = 'x' where branch_id = ${branchA} returning id`.catch((e) => e)).toMatchObject(denied);
    });
  });

  it("every section needs an answer, 'to fix' needs a note, and a future day cannot be closed", async () => {
    await as(u.bmB, async (tx) => {
      const { issues: _drop, ...six } = sections();
      void _drop;
      await expectError(tx, (sp) => close(sp, branchB, "2020-01-05", six), { message: "section_missing" });
      await expectError(tx, (sp) => close(sp, branchB, "2020-01-05", sections({ staff: { state: "maybe" } })), { message: "section_missing" });
      await expectError(tx, (sp) => close(sp, branchB, "2020-01-05", sections({ staff: { state: "fix", note: " " } })), { message: "fix_note_required" });
      await expectError(tx, (sp) => close(sp, branchB, "2999-01-01"), { message: "invalid date" });
      const [late] = await close(tx, branchB, "2020-01-05", sections({ staff: { state: "fix", note: "Two punches missing" }, incidents: { state: "none" } }));
      expect(late.is_late).toBe(true);
    });
  });

  it("the day's facts are counts only, for the branch's own viewers", async () => {
    const f = await as(u.bmA, async (tx) => (await tx`select app_day_facts(${branchA}, ${today}::date) as f`)[0].f);
    expect(f).toHaveProperty("payments.count");
    expect(JSON.stringify(f)).not.toMatch(/piastres|amount/i);
    await as(u.bmB, (tx) => expectError(tx, (sp) => sp`select app_day_facts(${branchA}, ${today}::date)`, denied));
    await as(u.teacherA, (tx) => expectError(tx, (sp) => sp`select app_day_facts(${branchA}, ${today}::date)`, denied));
    // Kept figures: each branch's own, and money figures only for those who see money.
    await owner`insert into kpi_daily_snapshot (branch_id, date, kpi_key, value, status) values
      (${branchA}, ${today}, 'children.active', 10, 'provisional'), (${branchA}, ${today}, 'money.billed', 500000, 'provisional')`;
    expect((await as(u.bmA, (tx) => tx`select kpi_key from kpi_daily_snapshot where branch_id = ${branchA}`)).map((r) => r.kpi_key)).toEqual(["children.active"]);
    expect(await as(u.bmB, (tx) => tx`select kpi_key from kpi_daily_snapshot where branch_id = ${branchA}`)).toHaveLength(0);
    expect(await as(u.accA, (tx) => tx`select kpi_key from kpi_daily_snapshot where branch_id = ${branchA}`)).toHaveLength(2);
    // An app connection that forgot its user is not "the system".
    await as(null, (tx) => expectError(tx, (sp) => sp`select app_day_facts(${branchA}, ${today}::date)`, denied));
  });
});

describe("month close (spec §8.10)", () => {
  const lines = async (tx: Sql, periodId: string, collectedNote: string | null) => {
    const [b] = await tx`insert into import_batch (branch_id, kind, file_name, row_count) values (${branchA}, 'month_close', ${`${lastMonth.slice(0, 7)} t.xlsx`}, 2) returning id`;
    await tx`insert into period_import_line (period_close_id, branch_id, batch_id, kind, line_key, app_piastres, amount_piastres, note)
      values (${periodId}, ${branchA}, ${b.id}, 'check', 'check:collected', 100000, 99000, ${collectedNote}),
             (${periodId}, ${branchA}, ${b.id}, 'central', 'central:salaries', null, 2100000, null)`;
    return b.id as string;
  };

  it("only the branch's accountant uploads and closes; the month must be over, with its template and notes", async () => {
    const period = async (tx: Sql, month: string) => (await tx`select app_period(${branchA}, ${month}::date) as id`)[0].id as string;
    await as(u.bmA, (tx) => expectError(tx, (sp) => sp`select app_period(${branchA}, ${lastMonth}::date)`, denied));
    await as(u.cm, async (tx) => {
      const id = await period(tx, lastMonth);
      await expectError(tx, (sp) => sp`select app_close_period(${id})`, denied);
      await expectError(tx, (sp) => sp`insert into import_batch (branch_id, kind, file_name, row_count) values (${branchA}, 'month_close', 'x', 1)`, denied);
    });
    await as(u.accA, async (tx) => {
      const id = await period(tx, lastMonth);
      await expectError(tx, (sp) => sp`select app_close_period(${id})`, { message: "template_required" });
      await expectError(tx, (sp) => sp`select app_period(${branchB}, ${lastMonth}::date)`, denied);
      await lines(tx, id, null);
      await expectError(tx, (sp) => sp`select app_close_period(${id})`, { message: "difference_note_required" });
      const thisMonth = await period(tx, today);
      await expectError(tx, (sp) => sp`select app_close_period(${thisMonth})`, { message: "month_not_over" });
    });
    // Another branch's manager and accountant-free roles never read the lines.
    expect(await as(u.bmA, (tx) => tx`select id from period_import_line where branch_id = ${branchA}`)).toHaveLength(0);
  });

  it("a closed month is locked; reopening needs a reason and the owner's decision", async () => {
    let id = "";
    // Commit the upload and the close.
    await app.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${u.accA}, true)`;
      id = (await tx`select app_period(${branchA}, ${lastMonth}::date) as id`)[0].id as string;
      await lines(tx, id, "One payment banked next month");
      await tx`select app_close_period(${id})`;
    });
    const [p] = await owner`select status, closed_by from period_close where id = ${id}`;
    expect(p).toMatchObject({ status: "closed", closed_by: u.accA });

    // Nothing new is dated in it: invoices, lines, balances. A late fee issued today for its tuition is fine.
    await expect(owner`insert into invoice (branch_id, family_id, student_id, service_month, issue_date, due_date) values (${branchA}, ${familyA}, ${studentA}, ${lastMonth}, ${lastMonth}, ${lastMonth})`).rejects.toMatchObject({ message: "month_closed" });
    await owner.begin(async (tx) => {
      await tx`insert into invoice (branch_id, family_id, student_id, service_month, issue_date, due_date, kind) values (${branchA}, ${familyA}, ${studentA}, ${lastMonth}, ${today}, ${today}, 'late_fee')`;
      throw new Error("rollback");
    }).catch((e) => expect(e.message).toBe("rollback"));
    await as(u.accA, async (tx) => {
      await expectError(tx, (sp) => sp`delete from period_import_line where period_close_id = ${id}`, { message: "month_closed" });
      await expectError(tx, (sp) => sp`insert into balance_snapshot (branch_id, month, cash_piastres) values (${branchA}, ${lastMonth}, 1)`, { message: "month_closed" });
      await expectError(tx, (sp) => sp`select app_close_period(${id})`, { message: "not_pending" });
    });

    // Money figures are Verified for a closed month, and only for those who see money.
    const acc = await as(u.accA, (tx) => tx`select key, status from app_kpis(${branchA}, (${lastMonth}::date + 20)) where key like 'money.%'`);
    expect(acc.find((k) => k.key === "money.billed")?.status).toBe("verified");
    expect(await as(u.bmA, (tx) => tx`select key from app_kpis(${branchA}, ${today}::date) where key like 'money.%'`)).toHaveLength(0);
    await as(u.bmB, (tx) => expectError(tx, (sp) => sp`select * from app_kpis(${branchA}, ${today}::date)`, denied));
    await as(null, (tx) => expectError(tx, (sp) => sp`select app_snapshot_kpis(${today}::date)`, denied));

    // Reopen: the accountant asks with a reason; the accountant cannot decide; the owner can.
    await as(u.accA, (tx) => expectError(tx, (sp) => sp`select app_request_period_reopen(${id}, 'no')`, { message: "reason_required" }));
    await app.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${u.accA}, true)`;
      await tx`select app_request_period_reopen(${id}, 'A refund was booked in the wrong month')`;
    });
    await as(u.accA, (tx) => expectError(tx, (sp) => sp`select app_decide_period_reopen(${id}, true)`, denied));
    await as(u.cm, (tx) => expectError(tx, (sp) => sp`select app_decide_period_reopen(${id}, true)`, denied));
    await app.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${u.owner}, true)`;
      await tx`select app_decide_period_reopen(${id}, true)`;
    });
    const [after] = await owner`select status, reopened_by from period_close where id = ${id}`;
    expect(after).toMatchObject({ status: "open", reopened_by: u.owner });
    const audit = await owner`select count(*)::int as n from audit_event where table_name = 'period_close' and row_id = ${id}`;
    expect(audit[0].n).toBeGreaterThanOrEqual(3);
  });
});
