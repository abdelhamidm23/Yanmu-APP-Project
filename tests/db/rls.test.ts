/**
 * Branch isolation and permission tests run against a real PostgreSQL (spec §13.1, rule 4).
 * Every role in Branch A tries to read and write Branch B's rows and must fail.
 *
 * Needs DATABASE_URL (the app role yanmu_app) and MIGRATION_DATABASE_URL (owner),
 * with migrations and `pnpm seed:base` applied. Run with `pnpm test:db`.
 */
import "dotenv/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/roles";

const owner = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 2, onnotice: () => {} });
const app = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });

type Sql = postgres.TransactionSql;
const run = `rls-${Date.now()}`;
let orgId: string;
let branchA: string;
let branchB: string;
let bandId: string;
const users: Record<string, string> = {};
let roomB: string;
let roomA: string;
const holidayB = "2031-01-07";
const holidayA = "2031-01-08";

async function makeUser(label: string, grants: [Role, string | null][], endDate: string | null = null) {
  const [u] = await owner`
    insert into app_user (full_name, email, end_date) values (${label}, ${`${label}.${run}@test.invalid`}, ${endDate}) returning id`;
  for (const [role, branch] of grants) {
    await owner`insert into user_branch_role (user_id, branch_id, role) values (${u.id}, ${branch}, ${role})`;
  }
  return u.id as string;
}

/** Runs fn as this user through the app role, inside a transaction that is always rolled back. */
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

/** Expects the statement to be refused by a policy or privilege (SQLSTATE 42501). */
async function expectDenied(tx: Sql, statement: (sp: Sql) => Promise<unknown>) {
  await expect(tx.savepoint((sp) => statement(sp))).rejects.toMatchObject({ code: "42501" });
}

beforeAll(async () => {
  [{ id: orgId }] = await owner`select id from organization limit 1`;
  [{ id: bandId }] = await owner`select id from age_band where key = 'toddlers'`;
  // Two fresh branches so the test never depends on other data.
  [{ id: branchA }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'أ', 'Test A', ${`${run}-A`}) returning id`;
  [{ id: branchB }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'ب', 'Test B', ${`${run}-B`}) returning id`;
  [{ id: roomA }] = await owner`insert into room (branch_id, name_ar, name_en, age_band_id, capacity) values (${branchA}, 'غرفة أ', 'Room A', ${bandId}, 12) returning id`;
  [{ id: roomB }] = await owner`insert into room (branch_id, name_ar, name_en, age_band_id, capacity) values (${branchB}, 'غرفة ب', 'Room B', ${bandId}, 12) returning id`;
  await owner`insert into calendar_day (branch_id, date, is_working_day, note) values (${branchB}, ${holidayB}, false, 'B holiday')`;
  await owner`insert into setting (org_id, branch_id, key, value) values (${orgId}, ${branchB}, 'ratio.snapshot_time', '"10:30"'::jsonb)`;

  for (const role of ROLES) users[`${role}A`] = await makeUser(`${role}-A`, [[role, branchA]]);
  users.ownerOrg = await makeUser("owner-org", [["owner", null]]);
  users.companyOrg = await makeUser("company-org", [["company_manager", null]]);
  users.staffB = await makeUser("staff-B", [["teacher", branchB]]);
  users.ended = await makeUser("ended", [["branch_manager", branchA]], "2020-01-01");
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

const BRANCH_ROLES = ROLES.map((r) => [r] as const);

describe.each(BRANCH_ROLES)("%s in Branch A cannot reach Branch B", (role) => {
  const me = () => users[`${role}A`];

  it("sees no Branch B rows", async () => {
    await as(me(), async (tx) => {
      expect(await tx`select id from branch where id = ${branchB}`).toHaveLength(0);
      expect(await tx`select id from room where branch_id = ${branchB}`).toHaveLength(0);
      expect(await tx`select 1 from calendar_day where branch_id = ${branchB}`).toHaveLength(0);
      expect(await tx`select 1 from setting where branch_id = ${branchB}`).toHaveLength(0);
      expect(await tx`select 1 from user_branch_role where branch_id = ${branchB}`).toHaveLength(0);
      expect(await tx`select 1 from audit_event where branch_id = ${branchB}`).toHaveLength(0);
    });
  });

  it("still sees its own branch", async () => {
    await as(me(), async (tx) => {
      expect(await tx`select id from branch where id = ${branchA}`).toHaveLength(1);
      expect(await tx`select id from room where id = ${roomA}`).toHaveLength(1);
    });
  });

  it("cannot create rows in Branch B", async () => {
    await as(me(), async (tx) => {
      await expectDenied(tx, (sp) => sp`insert into room (branch_id, name_ar, name_en, age_band_id, capacity) values (${branchB}, 'x', 'x', ${bandId}, 5)`);
      await expectDenied(tx, (sp) => sp`insert into calendar_day (branch_id, date, is_working_day) values (${branchB}, '2031-02-01', false)`);
      await expectDenied(tx, (sp) => sp`insert into setting (org_id, branch_id, key, value) values (${orgId}, ${branchB}, 'x', '1'::jsonb)`);
      await expectDenied(tx, (sp) => sp`insert into user_branch_role (user_id, branch_id, role) values (${me()}, ${branchB}, 'owner')`);
    });
  });

  it("cannot change or delete Branch B rows", async () => {
    await as(me(), async (tx) => {
      const updated = await tx`update room set name_en = 'hacked' where id = ${roomB}`;
      expect(updated.count).toBe(0);
      const updatedBranch = await tx`update branch set name_en = 'hacked' where id = ${branchB}`;
      expect(updatedBranch.count).toBe(0);
      const deleted = await tx`delete from calendar_day where branch_id = ${branchB}`;
      expect(deleted.count).toBe(0);
    });
    const [r] = await owner`select name_en from room where id = ${roomB}`;
    expect(r.name_en).toBe("Room B");
  });
});

describe("organization-wide roles", () => {
  it("owner and company manager see every branch", async () => {
    for (const u of [users.ownerOrg, users.companyOrg]) {
      await as(u, async (tx) => {
        expect(await tx`select id from branch where id in (${branchA}, ${branchB})`).toHaveLength(2);
        expect(await tx`select id from room where id in (${roomA}, ${roomB})`).toHaveLength(2);
      });
    }
  });

  it("company manager can add rooms but cannot hand out the owner role", async () => {
    await as(users.companyOrg, async (tx) => {
      const [r] = await tx`insert into room (branch_id, name_ar, name_en, age_band_id, capacity) values (${branchB}, 'ج', 'New', ${bandId}, 9) returning id`;
      expect(r.id).toBeTruthy();
      await expectDenied(tx, (sp) => sp`insert into user_branch_role (user_id, branch_id, role) values (${users.staffB}, null, 'owner')`);
      await tx`insert into user_branch_role (user_id, branch_id, role) values (${users.staffB}, ${branchB}, 'front_desk')`;
    });
  });

  it("nobody can change their own roles", async () => {
    await as(users.ownerOrg, async (tx) => {
      await expectDenied(tx, (sp) => sp`insert into user_branch_role (user_id, branch_id, role) values (${users.ownerOrg}, ${branchA}, 'teacher')`);
      const deleted = await tx`delete from user_branch_role where user_id = ${users.ownerOrg}`;
      expect(deleted.count).toBe(0);
    });
  });
});

describe("holidays (spec W1)", () => {
  it("branch manager adds a holiday in their own branch only", async () => {
    await as(users.branch_managerA, async (tx) => {
      await tx`insert into calendar_day (branch_id, date, is_working_day, note) values (${branchA}, ${holidayA}, false, 'Eid')`;
      await expectDenied(tx, (sp) => sp`insert into calendar_day (branch_id, date, is_working_day) values (${branchB}, ${holidayA}, false)`);
    });
  });

  it("a teacher cannot add holidays", async () => {
    await as(users.teacherA, async (tx) => {
      await expectDenied(tx, (sp) => sp`insert into calendar_day (branch_id, date, is_working_day) values (${branchA}, ${holidayA}, false)`);
    });
  });

  it("is_working_day follows the weekly pattern and exceptions", async () => {
    const [r] = await owner`
      select is_working_day(${branchB}, '2031-01-07') as holiday,  -- Tuesday, marked as holiday
             is_working_day(${branchB}, '2031-01-06') as monday,
             is_working_day(${branchB}, '2031-01-10') as friday`;
    expect(r).toEqual({ holiday: false, monday: true, friday: false });
  });
});

describe("no session, ended access", () => {
  it("without a signed-in user nothing is visible", async () => {
    await as(null, async (tx) => {
      expect(await tx`select id from branch`).toHaveLength(0);
      expect(await tx`select id from room`).toHaveLength(0);
      expect(await tx`select id from setting`).toHaveLength(0);
      expect(await tx`select id from organization`).toHaveLength(0);
    });
  });

  it("a user whose end date has passed sees nothing (spec §5)", async () => {
    await as(users.ended, async (tx) => {
      expect(await tx`select id from branch where id = ${branchA}`).toHaveLength(0);
      expect(await tx`select id from room where id = ${roomA}`).toHaveLength(0);
    });
  });
});

describe("audit trail (rule 7)", () => {
  it("records who changed what, with before and after", async () => {
    const newName = `Room A ${run}`;
    // Committed on purpose, so the audit row can be checked afterwards.
    await app.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${users.companyOrg}, true), set_config('app.audit_reason', 'rename for test', true)`;
      await tx`update room set name_en = ${newName} where id = ${roomA}`;
    });
    const [e] = await owner`
      select actor_user_id, branch_id, action, before->>'name_en' as before_name, after->>'name_en' as after_name, reason
      from audit_event where table_name = 'room' and row_id = ${roomA} and action = 'update' order by at desc limit 1`;
    expect(e).toEqual({
      actor_user_id: users.companyOrg,
      branch_id: branchA,
      action: "update",
      before_name: "Room A",
      after_name: newName,
      reason: "rename for test",
    });
    const [room] = await owner`select updated_by from room where id = ${roomA}`;
    expect(room.updated_by).toBe(users.companyOrg);
  });

  it("the app can never edit or delete audit rows, or write them directly", async () => {
    await as(users.ownerOrg, async (tx) => {
      await expectDenied(tx, (sp) => sp`update audit_event set reason = 'x'`);
      await expectDenied(tx, (sp) => sp`delete from audit_event`);
      await expectDenied(tx, (sp) => sp`insert into audit_event (table_name, row_id, action) values ('x', 'x', 'insert')`);
    });
  });

  it("only owner and company manager read the audit log", async () => {
    await as(users.ownerOrg, async (tx) => expect((await tx`select 1 from audit_event limit 1`).length).toBe(1));
    for (const role of ["branch_manager", "teacher", "front_desk", "hr"] as const) {
      await as(users[`${role}A`], async (tx) => expect(await tx`select 1 from audit_event limit 1`).toHaveLength(0));
    }
  });
});

describe("schema safety net", () => {
  it("every table with a branch_id column has row-level security enabled", async () => {
    const rows = await owner`
      select c.relname as table, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from information_schema.columns col
                    where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'branch_id')`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.rls, `${r.table} needs RLS`).toBe(true);
  });

  it("the app role owns no tables and cannot bypass row-level security", async () => {
    const [r] = await owner`select rolsuper, rolbypassrls from pg_roles where rolname = 'yanmu_app'`;
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await owner`select tablename from pg_tables where schemaname = 'public' and tableowner = 'yanmu_app'`;
    expect(owned).toHaveLength(0);
  });
});
