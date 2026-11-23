/**
 * Phase 7 database rules (spec §11.2, §11.3): the owner's Home reads figures only for branches the person
 * holds a role in, and "Ask branches to call these families" leaves a follow-up issue for that branch alone,
 * only when the owner or company manager asks.
 * Run with `pnpm test:db` against a migrated, seeded database.
 */
import "dotenv/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/lib/roles";

const owner = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 2, onnotice: () => {} });
const app = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });

type Sql = postgres.TransactionSql;
const run = `home-${Date.now()}`;
const code = `H${Date.now().toString(36).toUpperCase()}`;
let branchA: string;
let branchB: string;
const u: Record<string, string> = {};

async function makeUser(label: string, grants: [Role, string | null][]) {
  const [x] = await owner`insert into app_user (full_name, email) values (${label}, ${`${label}.${run}@test.invalid`}) returning id`;
  for (const [role, branch] of grants) await owner`insert into user_branch_role (user_id, branch_id, role) values (${x.id}, ${branch}, ${role})`;
  return x.id as string;
}

async function as<T>(userId: string, fn: (tx: Sql) => Promise<T>, keep = false): Promise<T> {
  let result: T;
  const rollback = new Error("rollback");
  try {
    await app.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${userId}, true)`;
      result = await fn(tx);
      if (!keep) throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  return result!;
}

const denied = { code: "42501" };
const ask = (tx: Sql, branch: string) => tx`select app_ask_to_call(${branch}, 'Call overdue families', 'A-0001 · Fam · 70 days') as id`;

beforeAll(async () => {
  const [{ id: orgId }] = await owner`select id from organization limit 1`;
  [{ id: branchA }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'أ', 'Home A', ${code + "A"}) returning id`;
  [{ id: branchB }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'ب', 'Home B', ${code + "B"}) returning id`;
  u.ownerA = await makeUser("ownerA", [["owner", branchA]]);
  u.cm = await makeUser("cm", [["company_manager", null]]);
  u.bmA = await makeUser("bmA", [["branch_manager", branchA]]);
  u.bmB = await makeUser("bmB", [["branch_manager", branchB]]);
  u.accA = await makeUser("accA", [["accountant", branchA]]);
});

afterAll(async () => {
  await owner`delete from notification where branch_id in (${branchA}, ${branchB})`;
  await owner`delete from alert where branch_id in (${branchA}, ${branchB})`;
  await owner`delete from issue where branch_id in (${branchA}, ${branchB})`;
  // Test branches stay out of the demo screens.
  await owner`update branch set is_active = false where id in (${branchA}, ${branchB})`;
  await owner.end();
  await app.end();
});

describe("Home figures stay in their branch (rule 4)", () => {
  it("a person reads figures only for branches they hold a role in", async () => {
    await as(u.ownerA, async (tx) => {
      expect((await tx`select key from app_kpis(${branchA}, current_date)`).length).toBeGreaterThan(10);
      await expect(tx.savepoint((sp) => sp`select key from app_kpis(${branchB}, current_date)`)).rejects.toMatchObject(denied);
    });
    // The branch manager sees counts but never the money figures.
    const keys = await as(u.bmA, (tx) => tx`select key from app_kpis(${branchA}, current_date)`);
    expect(keys.map((k) => k.key)).not.toContain("money.billed");
  });
});

describe("ask branches to call overdue families (spec §11.3)", () => {
  it("only the owner or company manager asks, only for their branches, and the issue stays in that branch", async () => {
    for (const who of [u.bmA, u.accA]) await as(who, (tx) => expect(tx.savepoint((sp) => ask(sp, branchA))).rejects.toMatchObject(denied));
    await as(u.ownerA, (tx) => expect(tx.savepoint((sp) => ask(sp, branchB))).rejects.toMatchObject(denied));

    const [{ id }] = await as(u.ownerA, (tx) => ask(tx, branchA), true);
    const [issue] = await owner`select branch_id, priority, status, created_by from issue where id = ${id}`;
    expect(issue).toMatchObject({ branch_id: branchA, priority: "high", status: "open", created_by: u.ownerA });
    // The branch's manager is told (in the app) and reads it; the other branch never sees it.
    const told = await owner`select n.user_id from notification n join alert a on a.id = n.alert_id where a.subject_id = ${id}`;
    expect(told.map((r) => r.user_id)).toContain(u.bmA);
    expect(told.map((r) => r.user_id)).not.toContain(u.bmB);
    expect(await as(u.bmA, (tx) => tx`select id from issue where id = ${id}`)).toHaveLength(1);
    expect(await as(u.bmB, (tx) => tx`select id from issue where id = ${id}`)).toHaveLength(0);
    // The company manager asks for any branch.
    await as(u.cm, (tx) => ask(tx, branchB));
    // Text is checked.
    await as(u.cm, (tx) => expect(tx.savepoint((sp) => sp`select app_ask_to_call(${branchA}, '', 'x')`)).rejects.toMatchObject({ code: "23514" }));
  });
});
