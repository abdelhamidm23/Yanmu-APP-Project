/**
 * Phase 4 database rules (spec §5, §7.5, §8.4 to §8.6): branch isolation for every money table,
 * append-only finance, receipts, allocation, voids, credit notes and approvals, expenses (routine or
 * not), the cash box and late fees across weekends and holidays, with exact piastre results.
 * Run with `pnpm test:db` against a migrated, seeded database.
 */
import "dotenv/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/roles";

const owner = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 2, onnotice: () => {} });
const app = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });

type Sql = postgres.TransactionSql;
const run = `money-${Date.now()}`;
const code = `M${Date.now().toString(36).toUpperCase()}`;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
let orgId: string;
let branchA: string;
let branchB: string;
const users: Record<string, string> = {};
const A = { family: "", student: "", invoice: "", lateInvoice: "", receipt: "", food: "", rent: "" };
const B = { family: "", student: "", invoice: "", payment: "", feeList: "", expense: "", session: "", creditNote: "", lock: "" };

async function makeUser(label: string, grants: [Role, string | null][]) {
  const [u] = await owner`insert into app_user (full_name, email) values (${label}, ${`${label}.${run}@test.invalid`}) returning id`;
  for (const [role, branch] of grants) await owner`insert into user_branch_role (user_id, branch_id, role) values (${u.id}, ${branch}, ${role})`;
  return u.id as string;
}

async function as<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  let result: T;
  const rollback = new Error("rollback");
  try {
    await app.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${userId}, true)`;
      result = await fn(tx);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  return result!;
}

/** Same, but the work is kept (for steps that later users act on). */
async function commitAs<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  })) as T;
}

async function expectError(tx: Sql, statement: (sp: Sql) => Promise<unknown>, match: Record<string, string>) {
  await expect(tx.savepoint((sp) => statement(sp))).rejects.toMatchObject(match);
}
const denied = { code: "42501" };

async function seedFamily(branch: string, label: string) {
  const [{ id: band }] = await owner`select id from age_band where key = 'toddlers'`;
  const [room] = await owner`insert into room (branch_id, name_ar, name_en, age_band_id, capacity) values (${branch}, ${label}, ${label}, ${band}, 12) returning id`;
  const [f] = await owner`insert into family (branch_id, account_no, display_name) values (${branch}, ${`${run}-${label}`}, ${label}) returning id`;
  const [s] = await owner`
    insert into student (branch_id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id)
    values (${branch}, ${`${run}-${label}`}, 'طفل', ${`Child ${label}`}, '2025-03-01', 'male', ${f.id}) returning id`;
  await owner`insert into enrollment (student_id, branch_id, room_id, start_date, status) values (${s.id}, ${branch}, ${room.id}, '2026-01-01', 'active')`;
  return { family: f.id as string, student: s.id as string };
}

/** A tuition invoice made as the system, with one line. */
async function seedInvoice(branch: string, fam: string, student: string, month: string, due: string, amount: number, kind = "tuition") {
  const [inv] = await owner`
    insert into invoice (branch_id, family_id, student_id, service_month, issue_date, due_date, kind)
    values (${branch}, ${fam}, ${student}, ${month}, ${month}, ${due}, ${kind}) returning id`;
  await owner`insert into invoice_line (invoice_id, branch_id, item_type, description, unit_piastres, amount_piastres, source)
              values (${inv.id}, ${branch}, ${kind === "late_fee" ? "late_fee" : "tuition"}, '', ${amount}, ${amount}, ${kind === "late_fee" ? "late_fee" : "fee_list"})`;
  return inv.id as string;
}

const invoiceRow = async (id: string) => (await owner`select status, total_piastres::int as total, paid_piastres::int as paid, credited_piastres::int as credited from invoice where id = ${id}`)[0];

beforeAll(async () => {
  [{ id: orgId }] = await owner`select id from organization limit 1`;
  [{ id: branchA }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'أ', 'Money A', ${code + "A"}) returning id`;
  [{ id: branchB }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'ب', 'Money B', ${code + "B"}) returning id`;
  for (const b of [branchA, branchB]) {
    await owner`insert into branch_routine_category (branch_id, category_id) select ${b}, id from expense_category where is_routine_default`;
  }
  [{ id: A.food }] = await owner`select id from expense_category where key = 'food'`;
  [{ id: A.rent }] = await owner`select id from expense_category where key = 'rent'`;

  for (const role of ROLES) users[`${role}A`] = await makeUser(`${role}-A`, [[role, branchA]]);
  users.accountantA2 = await makeUser("accountant-A2", [["accountant", branchA]]);
  users.companyOrg = await makeUser("company-org", [["company_manager", null]]);
  users.ownerOrg = await makeUser("owner-org", [["owner", null]]);

  Object.assign(A, await seedFamily(branchA, "A"));
  Object.assign(B, await seedFamily(branchB, "B"));
  A.invoice = await seedInvoice(branchA, A.family, A.student, "2026-11-01", "2026-11-05", 450000);
  B.invoice = await seedInvoice(branchB, B.family, B.student, "2026-11-01", "2026-11-05", 450000);
  [{ id: A.receipt }] = await owner`insert into attachment (branch_id, file_name, mime_type, size_bytes, data) values (${branchA}, 'r.jpg', 'image/jpeg', 3, '\\x010203') returning id`;

  [{ id: B.feeList }] = await owner`insert into fee_list (branch_id, name, effective_from) values (${branchB}, 'B fees', '2026-09-01') returning id`;
  await owner`insert into fee_list_item (fee_list_id, branch_id, item_type, monthly_amount_piastres) values (${B.feeList}, ${branchB}, 'tuition', 400000)`;
  await owner`insert into discount_rule (branch_id, name, type, value, starts_on) values (${branchB}, 'x', 'percent', 1000, '2026-01-01')`;
  [{ id: B.lock }] = await owner`insert into price_lock (student_id, branch_id, amount_piastres, reason, starts_on) values (${B.student}, ${branchB}, 300000, 'old price', '2025-01-01') returning id`;
  await owner`insert into student_service (student_id, branch_id, item_type, starts_on) values (${B.student}, ${branchB}, 'transport', '2026-01-01')`;
  [{ id: B.payment }] = await owner`insert into payment (branch_id, family_id, method, amount_piastres) values (${branchB}, ${B.family}, 'card', 100000) returning id`;
  await owner`insert into payment_allocation (payment_id, invoice_id, branch_id, amount_piastres) values (${B.payment}, ${B.invoice}, ${branchB}, 100000)`;
  [{ id: B.session }] = await owner`insert into cash_session (branch_id, date, opening_float_piastres) values (${branchB}, ${today}, 50000) returning id`;
  [{ id: B.creditNote }] = await owner`insert into credit_note (invoice_id, branch_id, amount_piastres, reason, kind) values (${B.invoice}, ${branchB}, 10000, 'typo fix', 'correction') returning id`;
  [{ id: B.expense }] = await owner`
    insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description)
    values (${branchB}, ${A.rent}, '2026-11-01', 5000, 'card', 'B rent part') returning id`;
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

const B_TABLES = [
  "fee_list", "fee_list_item", "price_lock", "discount_rule", "student_service", "invoice", "invoice_line",
  "cash_session", "payment", "payment_allocation", "credit_note", "branch_routine_category", "expense", "approval_step",
];

describe.each(ROLES.map((r) => [r] as const))("%s in Branch A cannot reach Branch B money", (role) => {
  const me = () => users[`${role}A`];

  it("sees no Branch B money rows", async () => {
    await as(me(), async (tx) => {
      for (const t of B_TABLES) {
        const rows = await tx`select 1 from ${tx(t)} where branch_id = ${branchB}`;
        expect(rows, t).toHaveLength(0);
      }
      expect(await tx`select 1 from approval_request where branch_id = ${branchB}`).toHaveLength(0);
    });
  });

  it("cannot write Branch B money rows", async () => {
    await as(me(), async (tx) => {
      await expectError(tx, (sp) => sp`insert into fee_list (branch_id, name, effective_from) values (${branchB}, 'x', '2026-01-01')`, denied);
      await expectError(tx, (sp) => sp`insert into invoice (branch_id, family_id, student_id, service_month, issue_date, due_date) values (${branchB}, ${B.family}, ${B.student}, '2026-12-01', '2026-12-01', '2026-12-05')`, denied);
      await expectError(tx, (sp) => sp`insert into payment (branch_id, family_id, method, amount_piastres) values (${branchB}, ${B.family}, 'card', 100)`, denied);
      await expectError(tx, (sp) => sp`insert into credit_note (invoice_id, branch_id, amount_piastres, reason, kind) values (${B.invoice}, ${branchB}, 100, 'reason', 'correction')`, denied);
      await expectError(tx, (sp) => sp`insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description) values (${branchB}, ${A.food}, ${today}, 500, 'card', 'x')`, denied);
      await expectError(tx, (sp) => sp`insert into cash_session (branch_id, date, opening_float_piastres) values (${branchB}, ${today}, 0)`, denied);
      await expectError(tx, (sp) => sp`insert into price_lock (student_id, branch_id, amount_piastres, reason, starts_on) values (${B.student}, ${branchB}, 1, 'r', '2026-01-01')`, denied);
      expect((await tx`update fee_list set name = 'hacked' where id = ${B.feeList}`).count).toBe(0);
      expect((await tx`update price_lock set amount_piastres = 1 where id = ${B.lock}`).count).toBe(0);
      expect((await tx`delete from student_service where branch_id = ${branchB}`).count).toBe(0);
    });
  });

  it("cannot void, decide, close or accrue for Branch B", async () => {
    await as(me(), async (tx) => {
      await expectError(tx, (sp) => sp`select app_void_payment(${B.payment}, 'wrong family')`, denied);
      await expectError(tx, (sp) => sp`select app_close_cash_session(${B.session}, 0, 0, '')`, denied);
      await expectError(tx, (sp) => sp`select app_accrue_late_fees(${branchB}, ${today}::date)`, denied);
      const [{ id: req }] = await owner`select approval_request_id as id from credit_note where id = ${B.creditNote}`;
      await expectError(tx, (sp) => sp`select app_decide_money(${req}, 'approve', '')`, denied);
    });
  });
});

describe("finance is append-only (rule 6)", () => {
  it("the app can never edit or delete invoices, payments, allocations, credit notes or expenses", async () => {
    await as(users.accountantA, async (tx) => {
      for (const t of ["invoice", "invoice_line", "payment", "payment_allocation", "credit_note", "expense", "cash_session", "approval_step"]) {
        await expectError(tx, (sp) => sp`update ${sp(t)} set updated_at = now() where branch_id = ${branchA}`, denied);
        await expectError(tx, (sp) => sp`delete from ${sp(t)} where branch_id = ${branchA}`, denied);
      }
    });
  });

  it("only the accountant issues invoices, and never late-fee ones by hand", async () => {
    const insert = (tx: Sql, kind = "tuition") =>
      tx`insert into invoice (branch_id, family_id, student_id, service_month, issue_date, due_date, kind)
         values (${branchA}, ${A.family}, ${A.student}, '2027-01-01', '2027-01-01', '2027-01-05', ${kind}) returning invoice_no, status`;
    await as(users.accountantA, async (tx) => {
      const [row] = await insert(tx);
      expect(row.invoice_no).toMatch(new RegExp(`^${code}A-I2027-\\d{5}$`));
      expect(row.status).toBe("open");
      await expectError(tx, (sp) => insert(sp, "late_fee"), denied);
    });
    for (const role of ["front_desk", "branch_manager", "owner", "company_manager"] as const) {
      await as(users[`${role}A`], async (tx) => expectError(tx, (sp) => insert(sp), denied));
    }
  });
});

describe("payments and receipts (spec §8.4.3)", () => {
  it("numbers receipts without gaps and keeps the invoice status", async () => {
    await as(users.front_deskA, async (tx) => {
      const pay = async (amount: number) => {
        const [p] = await tx`insert into payment (branch_id, family_id, method, amount_piastres) values (${branchA}, ${A.family}, 'card', ${amount}) returning id, receipt_no`;
        await tx`insert into payment_allocation (payment_id, invoice_id, branch_id, amount_piastres) values (${p.id}, ${A.invoice}, ${branchA}, ${amount})`;
        return p;
      };
      const p1 = await pay(200000);
      const p2 = await pay(250000);
      const n1 = Number(p1.receipt_no.slice(-5));
      expect(p1.receipt_no).toMatch(new RegExp(`^${code}A-R\\d{4}-\\d{5}$`));
      expect(Number(p2.receipt_no.slice(-5))).toBe(n1 + 1);
      const [inv] = await tx`select status, paid_piastres::int as paid from invoice where id = ${A.invoice}`;
      expect(inv).toEqual({ status: "paid", paid: 450000 });
    });
  });

  it("refuses to allocate more than the payment or the balance", async () => {
    await as(users.front_deskA, async (tx) => {
      const [p] = await tx`insert into payment (branch_id, family_id, method, amount_piastres) values (${branchA}, ${A.family}, 'card', 100000) returning id`;
      await expectError(tx, (sp) => sp`insert into payment_allocation (payment_id, invoice_id, branch_id, amount_piastres) values (${p.id}, ${A.invoice}, ${branchA}, 100001)`, { message: "over_allocated" });
      await expectError(tx, (sp) => sp`insert into payment_allocation (payment_id, invoice_id, branch_id, amount_piastres) values (${p.id}, ${B.invoice}, ${branchA}, 100)`, { code: "23514" });
    });
  });

  it("cash needs an open cash box", async () => {
    await as(users.front_deskA, async (tx) => {
      await expectError(tx, (sp) => sp`insert into payment (branch_id, family_id, method, amount_piastres) values (${branchA}, ${A.family}, 'cash', 1000)`, { message: "cash_box_not_open" });
    });
  });

  it("a void needs a reason and a second person; the invoice reopens", async () => {
    const [p] = await commitAs(users.branch_managerA, async (tx) => {
      const rows = await tx`insert into payment (branch_id, family_id, method, amount_piastres) values (${branchA}, ${A.family}, 'card', 450000) returning id`;
      await tx`insert into payment_allocation (payment_id, invoice_id, branch_id, amount_piastres) values (${rows[0].id}, ${A.invoice}, ${branchA}, 450000)`;
      return rows;
    });
    try {
      expect((await invoiceRow(A.invoice)).status).toBe("paid");
      await as(users.branch_managerA, async (tx) => {
        await expectError(tx, (sp) => sp`select app_void_payment(${p.id}, 'entered twice')`, { message: "own_request" });
      });
      await as(users.front_deskA, async (tx) => expectError(tx, (sp) => sp`select app_void_payment(${p.id}, 'entered twice')`, denied));
      await as(users.accountantA, async (tx) => {
        await expectError(tx, (sp) => sp`select app_void_payment(${p.id}, '')`, { message: "reason_required" });
        await tx`select app_void_payment(${p.id}, 'entered twice')`;
        const [inv] = await tx`select status, paid_piastres::int as paid from invoice where id = ${A.invoice}`;
        expect(inv).toEqual({ status: "open", paid: 0 });
        const [audit] = await tx`select after ->> 'void_reason' as r from audit_event where table_name = 'payment' and row_id = ${p.id} and action = 'update'`;
        expect(audit.r).toBe("entered twice");
      });
    } finally {
      await owner`delete from payment_allocation where payment_id = ${p.id}`;
      await owner`delete from payment where id = ${p.id}`;
      await owner`select app_refresh_invoice(${A.invoice})`;
    }
  });
});

describe("approvals for money (spec §8.6, §8.4.5)", () => {
  it("a correction up to the limit needs one approver, never the person who asked", async () => {
    await as(users.accountantA, async (tx) => {
      const [cn] = await tx`insert into credit_note (invoice_id, branch_id, amount_piastres, reason, kind) values (${A.invoice}, ${branchA}, 50000, 'charged the wrong band', 'correction') returning id, approval_request_id, status`;
      expect(cn.status).toBe("pending_approval");
      const [req] = await tx`select type, step_count, amount_piastres::int as amount, created_by from approval_request where id = ${cn.approval_request_id}`;
      expect(req).toMatchObject({ type: "credit_note", step_count: 1, amount: 50000, created_by: users.accountantA });
      await expectError(tx, (sp) => sp`insert into credit_note (invoice_id, branch_id, amount_piastres, reason, kind) values (${A.invoice}, ${branchA}, 50000, 'late fee', 'waiver')`, { message: "waiver_late_fee_only" });
      await expectError(tx, (sp) => sp`insert into credit_note (invoice_id, branch_id, amount_piastres, reason, kind) values (${A.invoice}, ${branchA}, 400001, 'too much', 'correction')`, { message: "too_much" });
    });
  });

  it("company manager approves a credit note: it gets a number and comes off the invoice", async () => {
    const [cn] = await commitAs(users.accountantA, (tx) => tx`insert into credit_note (invoice_id, branch_id, amount_piastres, reason, kind) values (${A.invoice}, ${branchA}, 50000, 'charged the wrong band', 'correction') returning id, approval_request_id`);
    const req = cn.approval_request_id;
    {
      await as(users.accountantA, async (tx) => expectError(tx, (sp) => sp`select app_decide_money(${req}, 'approve', '')`, denied));
      await as(users.branch_managerA, async (tx) => expectError(tx, (sp) => sp`select app_decide_money(${req}, 'approve', '')`, denied));
      await as(users.companyOrg, async (tx) => {
        await expectError(tx, (sp) => sp`select app_decide_money(${req}, 'reject', '')`, { message: "reason_required" });
        const [{ app_decide_money: r }] = await tx`select app_decide_money(${req}, 'approve', 'ok')`;
        expect(r).toBe("approved");
        const [c] = await tx`select status, credit_no from credit_note where id = ${cn.id}`;
        expect(c.status).toBe("approved");
        expect(c.credit_no).toMatch(new RegExp(`^${code}A-C\\d{4}-\\d{5}$`));
        const [inv] = await tx`select credited_piastres::int as credited from invoice where id = ${A.invoice}`;
        expect(inv.credited).toBe(50000);
      });
    }
  });

  it("above EGP 20,000: the company manager recommends, the owner decides", async () => {
    await as(users.branch_managerA, async (tx) => {
      const [e] = await tx`
        insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description, is_request)
        values (${branchA}, ${A.food}, ${today}, 2500000, 'bank_transfer', 'New kitchen fridge', true) returning id, status, unusual_reason, approval_request_id`;
      expect(e).toMatchObject({ status: "pending_approval", unusual_reason: "above_limit" });
      const [r] = await tx`select step_count from approval_request where id = ${e.approval_request_id}`;
      expect(r.step_count).toBe(2);
    });
    // The same, decided by others.
    const [e] = await commitAs(users.branch_managerA, (tx) => tx`
      insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description, is_request)
      values (${branchA}, ${A.food}, ${today}, 2500000, 'bank_transfer', 'New kitchen fridge', true) returning id, approval_request_id`);
    await as(users.companyOrg, async (tx) => {
      await expectError(tx, (sp) => sp`select app_decide_money(${e.approval_request_id}, 'approve', '')`, { message: "owner_decides" });
      await tx`select app_decide_money(${e.approval_request_id}, 'recommend_approve', 'Needed, quote attached')`;
      await expectError(tx, (sp) => sp`select app_decide_money(${e.approval_request_id}, 'approve', '')`, { message: "owner_decides" });
      const [s] = await tx`select status from expense where id = ${e.id}`;
      expect(s.status).toBe("pending_approval");
    });
    // Recommendation saved for real, then the owner decides.
    await owner.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${users.companyOrg}, true)`;
      await tx`select app_decide_money(${e.approval_request_id}, 'recommend_approve', 'Needed, quote attached')`;
    });
    await as(users.ownerOrg, async (tx) => {
      await expectError(tx, (sp) => sp`select app_decide_money(${e.approval_request_id}, 'recommend_approve', '')`, { code: "22023" });
      const [{ app_decide_money: r }] = await tx`select app_decide_money(${e.approval_request_id}, 'approve', '')`;
      expect(r).toBe("approved");
      const steps = await tx`select step_no, decision from approval_step where request_id = ${e.approval_request_id} order by step_no`;
      expect(steps).toEqual([{ step_no: 1, decision: "recommend_approve" }, { step_no: 2, decision: "approve" }]);
      const [s] = await tx`select status from expense where id = ${e.id}`;
      expect(s.status).toBe("approved");
    });
  });

  it("a question goes back to the person who asked", async () => {
    const [e] = await commitAs(users.branch_managerA, (tx) => tx`
      insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description, is_request)
      values (${branchA}, ${A.rent}, ${today}, 300000, 'cash', 'Storage room for a month', true) returning id, approval_request_id, unusual_reason`);
    expect(e.unusual_reason).toBe("not_routine");
    await owner.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${users.companyOrg}, true)`;
      await expect(tx.savepoint((sp) => sp`select app_decide_money(${e.approval_request_id}, 'question', '')`)).rejects.toMatchObject({ message: "reason_required" });
      await tx`select app_decide_money(${e.approval_request_id}, 'question', 'Which room?')`;
    });
    await as(users.companyOrg, async (tx) => expectError(tx, (sp) => sp`select app_decide_money(${e.approval_request_id}, 'approve', '')`, { message: "not_pending" }));
    await as(users.branch_managerA, async (tx) => {
      const [{ app_decide_money: r }] = await tx`select app_decide_money(${e.approval_request_id}, 'answer', 'The one behind the kitchen')`;
      expect(r).toBe("pending");
    });
  });
});

describe("expenses: routine or not (spec §8.6, D10)", () => {
  const add = (tx: Sql, amount: number, category = A.food, extra: { flagged?: string; receipt?: string | null } = {}) =>
    tx`insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description, receipt_attachment_id, flagged_note)
       values (${branchA}, ${category}, ${today}, ${amount}, 'card', 'Groceries', ${extra.receipt === undefined ? A.receipt : extra.receipt}, ${extra.flagged ?? null})
       returning status, is_unusual, unusual_reason, approval_request_id`;

  it("a routine category with no history yet is recorded at once", async () => {
    await as(users.branch_managerA, async (tx) => {
      expect((await add(tx, 500000))[0]).toMatchObject({ status: "recorded", is_unusual: false, approval_request_id: null });
    });
  });

  it("needs a receipt photo from EGP 100", async () => {
    await as(users.branch_managerA, async (tx) => {
      await expectError(tx, (sp) => add(sp, 10000, A.food, { receipt: null }), { message: "receipt_required" });
      expect((await add(tx, 9999, A.food, { receipt: null }))[0].status).toBe("recorded");
    });
  });

  it("is unusual above 2× the 3-month average, once there are 3 months of history", async () => {
    const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    // History: one 4 months ago, three in the last 3 months at EGP 1,000.
    for (const [ago, amount] of [[125, 100000], [80, 100000], [40, 100000], [10, 100000]]) {
      await owner`insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description, receipt_attachment_id)
                  values (${branchA}, ${A.food}, ${day(ago)}, ${amount}, 'card', 'history', ${A.receipt})`;
    }
    await as(users.branch_managerA, async (tx) => {
      expect((await add(tx, 200000))[0]).toMatchObject({ status: "recorded" });
      expect((await add(tx, 200001))[0]).toMatchObject({ status: "pending_approval", unusual_reason: "above_average" });
      expect((await add(tx, 50000, A.food, { flagged: "Party supplies" }))[0]).toMatchObject({ status: "pending_approval", unusual_reason: "flagged" });
      expect((await add(tx, 50000, A.rent))[0]).toMatchObject({ status: "pending_approval", unusual_reason: "not_routine" });
    });
    await owner`delete from expense where branch_id = ${branchA} and description = 'history'`;
  });

  it("a reversal cancels a recorded expense and marks it reversed", async () => {
    const [e] = await owner`insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description, receipt_attachment_id)
                            values (${branchA}, ${A.food}, ${today}, 30000, 'card', 'Bread', ${A.receipt}) returning id`;
    await as(users.accountantA, async (tx) => {
      await expectError(tx, (sp) => sp`insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description, reverses_expense_id) values (${branchA}, ${A.food}, ${today}, -1, 'card', '', ${e.id})`, { message: "reason_required" });
      const [r] = await tx`insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description, reverses_expense_id)
                           values (${branchA}, ${A.food}, ${today}, -1, 'card', 'Entered twice', ${e.id}) returning amount_piastres::int as amount, status`;
      expect(r).toEqual({ amount: -30000, status: "recorded" });
      const [o] = await tx`select status from expense where id = ${e.id}`;
      expect(o.status).toBe("reversed");
      await expectError(tx, (sp) => sp`insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description, reverses_expense_id) values (${branchA}, ${A.food}, ${today}, -1, 'card', 'Again', ${e.id})`, { message: "not_pending" });
    });
  });

  it("front desk and teachers cannot record expenses", async () => {
    for (const role of ["front_desk", "teacher", "hr"] as const) {
      await as(users[`${role}A`], async (tx) => expectError(tx, (sp) => add(sp, 1000), denied));
    }
  });
});

describe("cash box (spec §8.5)", () => {
  it("opens with a float, takes cash, closes with a variance, then the accountant reconciles", async () => {
    await as(users.front_deskA, async (tx) => {
      await expectError(tx, (sp) => sp`insert into cash_session (branch_id, date, opening_float_piastres) values (${branchA}, '2026-01-01', 0)`, { message: "not_today" });
      const [s] = await tx`insert into cash_session (branch_id, date, opening_float_piastres) values (${branchA}, ${today}, 100000) returning id`;
      const [p] = await tx`insert into payment (branch_id, family_id, method, amount_piastres) values (${branchA}, ${A.family}, 'cash', 1250000) returning cash_session_id`;
      expect(p.cash_session_id).toBe(s.id);
      await expectError(tx, (sp) => sp`select app_close_cash_session(${s.id}, 45000, 1200000, '')`, { message: "reason_required" });
      const [{ app_close_cash_session: variance }] = await tx`select app_close_cash_session(${s.id}, 45000, 1200000, 'Branch manager')`;
      expect(Number(variance)).toBe(105000); // 1,000 + 12,500 − 0 − 12,000 − 450 = 1,050 EGP missing
      await expectError(tx, (sp) => sp`select app_close_cash_session(${s.id}, 0, 0, '')`, { message: "already_closed" });
      await expectError(tx, (sp) => sp`select app_reconcile_cash_session(${s.id})`, denied);
      await expectError(tx, (sp) => sp`insert into payment (branch_id, family_id, method, amount_piastres) values (${branchA}, ${A.family}, 'cash', 1000)`, { message: "cash_box_not_open" });
    });
  });

  it("counts cash expenses as cash out", async () => {
    const [s] = await owner`insert into cash_session (branch_id, date, opening_float_piastres) values (${branchA}, ${today}, 100000) returning id`;
    try {
      await as(users.branch_managerA, async (tx) => {
        await tx`insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description, receipt_attachment_id)
                 values (${branchA}, ${A.food}, ${today}, 30000, 'cash', 'Milk', ${A.receipt})`;
        const [t] = await tx`select cash_in::int, cash_out::int from app_cash_session_totals(${s.id})`;
        expect(t).toEqual({ cash_in: 0, cash_out: 30000 });
        const [{ app_close_cash_session: v }] = await tx`select app_close_cash_session(${s.id}, 70000, 0, '')`;
        expect(Number(v)).toBe(0);
      });
    } finally {
      await owner`delete from cash_session where id = ${s.id}`;
    }
  });
});

describe("late fees (spec §8.4.4, D5)", () => {
  // Due Thursday 3 Sep 2026. Fri 4 and Sat 5 are the weekend, Tue 8 Sep is a branch holiday.
  // Paid in full on Thursday 10 Sep: working days charged are Sun 6, Mon 7, Wed 9 and Thu 10.
  it("accrues EGP 500 per working day until the day the tuition is paid", async () => {
    const [{ id: lateBranch }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'ج', 'Late C', ${code + "C"}) returning id`;
    await owner`insert into user_branch_role (user_id, branch_id, role) values (${users.accountantA}, ${lateBranch}, 'accountant')`;
    await owner`insert into calendar_day (branch_id, date, is_working_day, note) values (${lateBranch}, '2026-09-08', false, 'Holiday')`;
    const fam = await seedFamily(lateBranch, "C");
    const inv = await seedInvoice(lateBranch, fam.family, fam.student, "2026-09-01", "2026-09-03", 450000);
    const [p] = await owner`insert into payment (branch_id, family_id, method, amount_piastres, received_at) values (${lateBranch}, ${fam.family}, 'card', 450000, '2026-09-10 10:00+03') returning id`;
    await owner`insert into payment_allocation (payment_id, invoice_id, branch_id, amount_piastres) values (${p.id}, ${inv}, ${lateBranch}, 450000)`;

    await as(users.accountantA, async (tx) => {
      const [{ n }] = await tx`select app_accrue_late_fees(${lateBranch}, '2026-09-20'::date) as n`;
      expect(n).toBe(4);
      const lines = await tx`
        select to_char(l.accrual_date, 'YYYY-MM-DD') as day, l.amount_piastres::int as amount, l.created_by
        from invoice_line l join invoice i on i.id = l.invoice_id
        where i.student_id = ${fam.student} and i.kind = 'late_fee' order by l.accrual_date`;
      expect(lines.map((l) => l.day)).toEqual(["2026-09-06", "2026-09-07", "2026-09-09", "2026-09-10"]);
      expect(lines.every((l) => l.amount === 50000 && l.created_by === null)).toBe(true);
      const [lf] = await tx`select total_piastres::int as total, due_date::text as due, status from invoice where student_id = ${fam.student} and kind = 'late_fee'`;
      expect(lf).toEqual({ total: 200000, due: "2026-09-06", status: "open" });
      // Running again adds nothing.
      const [{ n: again }] = await tx`select app_accrue_late_fees(${lateBranch}, '2026-09-20'::date) as n`;
      expect(again).toBe(0);
    });
  });

  it("respects a cap and the per-family basis", async () => {
    const [{ id: capBranch }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'د', 'Late D', ${code + "D"}) returning id`;
    await owner`insert into setting (org_id, branch_id, key, value) values (${orgId}, ${capBranch}, 'late_fee.cap_piastres', '120000'::jsonb)`;
    await owner`insert into setting (org_id, branch_id, key, value) values (${orgId}, ${capBranch}, 'late_fee.basis', '"per_family"'::jsonb)`;
    const fam = await seedFamily(capBranch, "D");
    const [s2] = await owner`
      insert into student (branch_id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id)
      values (${capBranch}, ${`${run}-D2`}, 'طفل', 'Child D2', '2025-03-01', 'female', ${fam.family}) returning id`;
    await seedInvoice(capBranch, fam.family, fam.student, "2026-09-01", "2026-09-03", 450000);
    await seedInvoice(capBranch, fam.family, s2.id, "2026-09-01", "2026-09-03", 450000);
    await owner.begin(async (tx) => {
      const [{ n }] = await tx`select app_accrue_late_fees(${capBranch}, '2026-09-20'::date) as n`;
      expect(n).toBe(3); // 500 + 500 + 200 = the EGP 1,200 cap, one invoice for the family
      const rows = await tx`select student_id, total_piastres::int as total from invoice where family_id = ${fam.family} and kind = 'late_fee'`;
      expect(rows).toEqual([{ student_id: null, total: 120000 }]);
    });
  });

  it("a waiver is a credit note on the late-fee invoice", async () => {
    const lf = await seedInvoice(branchA, A.family, A.student, "2026-10-01", "2026-10-06", 150000, "late_fee");
    await as(users.branch_managerA, async (tx) => {
      const [cn] = await tx`insert into credit_note (invoice_id, branch_id, amount_piastres, reason, kind) values (${lf}, ${branchA}, 150000, 'Family emergency', 'waiver') returning approval_request_id`;
      const [r] = await tx`select type from approval_request where id = ${cn.approval_request_id}`;
      expect(r.type).toBe("late_fee_waiver");
    });
  });
});

describe("demo documents and receipt photos", () => {
  it("demo payments take their own DEMO- numbers and leave the real sequence alone", async () => {
    await as(users.front_deskA, async (tx) => {
      const [f] = await owner`insert into family (branch_id, account_no, display_name, is_demo) values (${branchA}, ${`${run}-demo`}, 'Demo', true) returning id`;
      const [real1] = await tx`insert into payment (branch_id, family_id, method, amount_piastres) values (${branchA}, ${A.family}, 'card', 100) returning receipt_no, is_demo`;
      const [demo] = await tx`insert into payment (branch_id, family_id, method, amount_piastres) values (${branchA}, ${f.id}, 'card', 100) returning receipt_no, is_demo`;
      const [real2] = await tx`insert into payment (branch_id, family_id, method, amount_piastres) values (${branchA}, ${A.family}, 'card', 100) returning receipt_no, is_demo`;
      expect(demo.is_demo).toBe(true);
      expect(demo.receipt_no).toMatch(new RegExp(`^DEMO-${code}A-R\\d{4}-\\d{5}$`));
      expect(real1.is_demo).toBe(false);
      expect(Number(real2.receipt_no.slice(-5))).toBe(Number(real1.receipt_no.slice(-5)) + 1);
    });
  });

  it("the person who uploads a receipt photo can read it; another branch cannot", async () => {
    const id = await commitAs(users.branch_managerA, async (tx) => {
      const [a] = await tx`insert into attachment (branch_id, file_name, mime_type, size_bytes, data) values (${branchA}, 'r.jpg', 'image/jpeg', 3, '\\x010203') returning id`;
      return a.id as string;
    });
    await as(users.branch_managerA, async (tx) => {
      expect(await tx`select id from attachment where id = ${id}`).toHaveLength(1);
    });
    const other = await makeUser("bm-B-photo", [["branch_manager", branchB]]);
    await as(other, async (tx) => {
      expect(await tx`select id from attachment where id = ${id}`).toHaveLength(0);
      await expectError(tx, (sp) => sp`insert into attachment (branch_id, file_name, mime_type, size_bytes, data) values (${branchA}, 'x.jpg', 'image/jpeg', 1, '\\x01')`, denied);
    });
    // The accountant reads it once an expense uses it.
    await as(users.accountantA, async (tx) => {
      expect(await tx`select id from attachment where id = ${id}`).toHaveLength(0);
    });
    await owner`insert into expense (branch_id, category_id, spent_on, amount_piastres, payment_method, description, receipt_attachment_id)
                values (${branchA}, ${A.food}, ${today}, 1000, 'card', 'photo test', ${id})`;
    await as(users.accountantA, async (tx) => {
      expect(await tx`select id from attachment where id = ${id}`).toHaveLength(1);
    });
  });
});
