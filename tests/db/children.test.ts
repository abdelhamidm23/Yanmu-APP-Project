/**
 * Phase 2 database rules: who sees children's records, medical privacy, the licence cap,
 * age checks, transfers between branches and import rollback (spec §5, §7.3, §8.1, D11).
 * Run with `pnpm test:db` against a migrated, seeded database.
 */
import "dotenv/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/roles";

const owner = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 2, onnotice: () => {} });
const app = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });

type Sql = postgres.TransactionSql;
const run = `kids-${Date.now()}`;
let orgId: string;
let branchA: string;
let branchB: string;
let toddlers: string;
let babies: string;
let roomA: string;
let roomA2: string;
let babiesA: string;
let roomB: string;
const users: Record<string, string> = {};
const kidA = { family: "", student: "", guardian: "", enrollment: "" };
const kidB = { family: "", student: "", guardian: "", enrollment: "" };

/** ISO date `months` months before today (UTC), on the 1st so month arithmetic is exact. */
function monthsAgo(months: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
const today = () => new Date().toISOString().slice(0, 10);

async function makeUser(label: string, grants: [Role, string | null][]) {
  const [u] = await owner`insert into app_user (full_name, email) values (${label}, ${`${label}.${run}@test.invalid`}) returning id`;
  for (const [role, branch] of grants) {
    await owner`insert into user_branch_role (user_id, branch_id, role) values (${u.id}, ${branch}, ${role})`;
  }
  return u.id as string;
}

/** Runs fn as this user through the app role, inside a transaction that is always rolled back. */
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

async function expectError(tx: Sql, statement: (sp: Sql) => Promise<unknown>, match: Record<string, string>) {
  await expect(tx.savepoint((sp) => statement(sp))).rejects.toMatchObject(match);
}
const denied = { code: "42501" };

/** Creates a family, one guardian, a child and (optionally) an active enrollment, as the database owner. */
async function seedChild(branch: string, room: string, label: string, opts: { family?: string; dob?: string } = {}) {
  const family =
    opts.family ??
    (await owner`insert into family (branch_id, account_no, display_name) values (${branch}, ${`${run}-${label}-F`}, ${`Family ${label}`}) returning id`)[0].id;
  const [g] = await owner`
    insert into guardian (family_id, branch_id, full_name, relationship, phone)
    values (${family}, ${branch}, ${`Parent ${label}`}, 'mother', '01000000000') returning id`;
  const [s] = await owner`
    insert into student (branch_id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id)
    values (${branch}, ${`${run}-${label}`}, 'طفل', ${`Child ${label}`}, ${opts.dob ?? monthsAgo(18)}, 'female', ${family}) returning id`;
  await owner`insert into student_guardian (student_id, guardian_id, branch_id, is_primary_contact) values (${s.id}, ${g.id}, ${branch}, true)`;
  const [e] = await owner`
    insert into enrollment (student_id, branch_id, room_id, start_date, status)
    values (${s.id}, ${branch}, ${room}, ${monthsAgo(2)}, 'active') returning id`;
  await owner`insert into student_medical (student_id, branch_id, allergies) values (${s.id}, ${branch}, 'Peanuts')`;
  await owner`insert into consent_record (student_id, guardian_id, branch_id, purpose, granted_on) values (${s.id}, ${g.id}, ${branch}, 'photos', ${monthsAgo(2)})`;
  return { family: family as string, student: s.id as string, guardian: g.id as string, enrollment: e.id as string };
}

beforeAll(async () => {
  [{ id: orgId }] = await owner`select id from organization limit 1`;
  [{ id: toddlers }] = await owner`select id from age_band where key = 'toddlers'`;
  [{ id: babies }] = await owner`select id from age_band where key = 'babies'`;
  [{ id: branchA }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'أ', 'Kids A', ${`${run}A`}) returning id`;
  [{ id: branchB }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'ب', 'Kids B', ${`${run}B`}) returning id`;
  const room = async (branch: string, band: string, name: string) =>
    (await owner`insert into room (branch_id, name_ar, name_en, age_band_id, capacity) values (${branch}, ${name}, ${name}, ${band}, 12) returning id`)[0].id as string;
  roomA = await room(branchA, toddlers, "Toddlers A");
  roomA2 = await room(branchA, toddlers, "Toddlers A2");
  babiesA = await room(branchA, babies, "Babies A");
  roomB = await room(branchB, toddlers, "Toddlers B");

  for (const role of ROLES) users[`${role}A`] = await makeUser(`${role}-A`, [[role, branchA]]);
  users.teacherNoRoom = await makeUser("teacher-no-room", [["teacher", branchA]]);
  users.managerB = await makeUser("manager-B", [["branch_manager", branchB]]);
  users.ownerOrg = await makeUser("owner-org", [["owner", null]]);
  users.companyOrg = await makeUser("company-org", [["company_manager", null]]);
  await owner`insert into user_room (user_id, room_id, branch_id) values (${users.teacherA}, ${roomA}, ${branchA})`;

  Object.assign(kidA, await seedChild(branchA, roomA, "A"));
  Object.assign(kidB, await seedChild(branchB, roomB, "B"));
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

describe.each(ROLES.map((r) => [r] as const))("%s in Branch A cannot reach Branch B children", (role) => {
  const me = () => users[`${role}A`];

  it("sees none of Branch B's children, families, guardians or enrollments", async () => {
    await as(me(), async (tx) => {
      expect(await tx`select 1 from student where id = ${kidB.student}`).toHaveLength(0);
      expect(await tx`select 1 from family where id = ${kidB.family}`).toHaveLength(0);
      expect(await tx`select 1 from guardian where id = ${kidB.guardian}`).toHaveLength(0);
      expect(await tx`select 1 from student_guardian where student_id = ${kidB.student}`).toHaveLength(0);
      expect(await tx`select 1 from enrollment where id = ${kidB.enrollment}`).toHaveLength(0);
      expect(await tx`select 1 from student_medical where student_id = ${kidB.student}`).toHaveLength(0);
      expect(await tx`select 1 from consent_record where student_id = ${kidB.student}`).toHaveLength(0);
    });
  });

  it("cannot add or change Branch B children", async () => {
    await as(me(), async (tx) => {
      await expectError(
        tx,
        (sp) => sp`insert into family (branch_id, account_no, display_name) values (${branchB}, ${`${run}-x`}, 'x')`,
        denied,
      );
      await expectError(
        tx,
        (sp) => sp`insert into waitlist_entry (branch_id, student_name, date_of_birth, guardian_phone, requested_start_month)
                   values (${branchB}, 'x', ${monthsAgo(6)}, '010', ${today()})`,
        denied,
      );
      expect((await tx`update student set full_name_en = 'hacked' where id = ${kidB.student}`).count).toBe(0);
      expect((await tx`update enrollment set status = 'withdrawn' where id = ${kidB.enrollment}`).count).toBe(0);
      expect((await tx`delete from student where id = ${kidB.student}`).count).toBe(0);
    });
  });
});

describe("who sees a child in their own branch (spec §5)", () => {
  it("owner, managers, front desk and accountant see the child", async () => {
    for (const u of [users.ownerOrg, users.companyOrg, users.branch_managerA, users.front_deskA, users.accountantA]) {
      await as(u, async (tx) => expect(await tx`select 1 from student where id = ${kidA.student}`).toHaveLength(1));
    }
  });

  it("a teacher sees only the children in rooms they look after", async () => {
    await as(users.teacherA, async (tx) => {
      expect(await tx`select 1 from student where id = ${kidA.student}`).toHaveLength(1);
      expect(await tx`select 1 from guardian where id = ${kidA.guardian}`).toHaveLength(1);
    });
    await as(users.teacherNoRoom, async (tx) => {
      expect(await tx`select 1 from student where id = ${kidA.student}`).toHaveLength(0);
      expect(await tx`select 1 from guardian where id = ${kidA.guardian}`).toHaveLength(0);
    });
  });

  it("HR does not see children", async () => {
    await as(users.hrA, async (tx) => expect(await tx`select 1 from student where id = ${kidA.student}`).toHaveLength(0));
  });

  it("only branch manager and front desk edit; teachers and accountants cannot", async () => {
    for (const u of [users.branch_managerA, users.front_deskA]) {
      await as(u, async (tx) =>
        expect((await tx`update student set full_name_en = 'Renamed' where id = ${kidA.student}`).count).toBe(1),
      );
    }
    for (const u of [users.teacherA, users.accountantA, users.ownerOrg]) {
      await as(u, async (tx) =>
        expect((await tx`update student set full_name_en = 'Renamed' where id = ${kidA.student}`).count).toBe(0),
      );
    }
  });
});

describe("medical notes (spec §5)", () => {
  it("branch manager and the child's teacher can read them", async () => {
    for (const u of [users.branch_managerA, users.teacherA]) {
      await as(u, async (tx) => {
        const rows = await tx`select allergies from student_medical where student_id = ${kidA.student}`;
        expect(rows).toEqual([{ allergies: "Peanuts" }]);
      });
    }
  });

  it("front desk, accountant, HR, owner and company manager cannot read them directly", async () => {
    for (const u of [users.front_deskA, users.accountantA, users.hrA, users.ownerOrg, users.companyOrg, users.teacherNoRoom]) {
      await as(u, async (tx) => expect(await tx`select 1 from student_medical where student_id = ${kidA.student}`).toHaveLength(0));
    }
  });

  it("owner can break the glass with a reason, and it is logged", async () => {
    await as(users.ownerOrg, async (tx) => {
      await expectError(tx, (sp) => sp`select * from app_break_glass_medical(${kidA.student}, '')`, { message: "reason_required" });
      const rows = await tx`select allergies from app_break_glass_medical(${kidA.student}, 'Ambulance called')`;
      expect(rows).toEqual([{ allergies: "Peanuts" }]);
      const [e] = await tx`select actor_user_id, reason from audit_event where table_name = 'student_medical' and action = 'break_glass' and row_id = ${kidA.student}`;
      expect(e).toEqual({ actor_user_id: users.ownerOrg, reason: "Ambulance called" });
    });
  });

  it("front desk cannot break the glass", async () => {
    await as(users.front_deskA, async (tx) => {
      await expectError(tx, (sp) => sp`select * from app_break_glass_medical(${kidA.student}, 'Just curious')`, denied);
    });
  });

  it("the audit log never holds the medical text", async () => {
    await app.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${users.branch_managerA}, true)`;
      await tx`update student_medical set conditions = 'Asthma' where student_id = ${kidA.student}`;
    });
    const rows = await owner`select before, after from audit_event where table_name = 'student_medical' and row_id = ${kidA.student} and action = 'update'`;
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/Asthma|Peanuts/);
  });
});

describe("adding a child", () => {
  it("front desk adds a family, guardian, child and enrollment; branch is taken from the parent", async () => {
    await as(users.front_deskA, async (tx) => {
      const [{ no }] = await tx`select app_next_family_no(${branchA}) as no`;
      expect(no).toBe(`${run}A-F0001`);
      const [f] = await tx`insert into family (branch_id, account_no, display_name) values (${branchA}, ${no}, 'New family') returning id`;
      // A wrong branch on the guardian is replaced by the family's branch.
      const [g] = await tx`
        insert into guardian (family_id, branch_id, full_name, relationship, phone)
        values (${f.id}, ${branchB}, 'Mona', 'mother', '01011111111') returning branch_id`;
      expect(g.branch_id).toBe(branchA);
      const [{ sno }] = await tx`select app_next_student_no(${branchA}) as sno`;
      expect(sno).toBe(`${run}A-0001`);
      const [s] = await tx`
        insert into student (branch_id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id, status)
        values (${branchA}, ${sno}, 'سلمى', 'Salma', ${monthsAgo(14)}, 'female', ${f.id}, 'pending') returning id`;
      await tx`insert into enrollment (student_id, branch_id, room_id, start_date, status) values (${s.id}, ${branchA}, ${roomA}, ${today()}, 'active')`;
      const [st] = await tx`select status from student where id = ${s.id}`;
      expect(st.status).toBe("active");
    });
  });

  it("a child cannot join a family account in another branch", async () => {
    await as(users.companyOrg, async (tx) => {
      const [b] = await tx`insert into import_batch (branch_id, kind, file_name, row_count) values (${branchA}, 'children', 'x.xlsx', 1) returning id`;
      await expectError(
        tx,
        (sp) => sp`insert into student (branch_id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id, import_batch_id)
                   values (${branchA}, ${`${run}-mix`}, 'x', 'x', ${monthsAgo(14)}, 'male', ${kidB.family}, ${b.id})`,
        { code: "23514" },
      );
    });
  });

  it("checks age: under 3 months refused, other age band needs a reason", async () => {
    await as(users.front_deskA, async (tx) => {
      const [s] = await tx`
        insert into student (branch_id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id)
        values (${branchA}, ${`${run}-baby`}, 'x', 'Tiny', ${monthsAgo(1)}, 'male', ${kidA.family}) returning id`;
      await expectError(
        tx,
        (sp) => sp`insert into enrollment (student_id, branch_id, room_id, start_date, status) values (${s.id}, ${branchA}, ${babiesA}, ${today()}, 'active')`,
        { message: "age_out_of_range" },
      );
      const [s2] = await tx`
        insert into student (branch_id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id)
        values (${branchA}, ${`${run}-older`}, 'x', 'Older', ${monthsAgo(30)}, 'male', ${kidA.family}) returning id`;
      await expectError(
        tx,
        (sp) => sp`insert into enrollment (student_id, branch_id, room_id, start_date, status) values (${s2.id}, ${branchA}, ${roomA}, ${today()}, 'active')`,
        { message: "band_reason_required" },
      );
      await tx`insert into enrollment (student_id, branch_id, room_id, start_date, status, band_override_reason)
               values (${s2.id}, ${branchA}, ${roomA}, ${today()}, 'active', 'Settling in with sibling')`;
    });
  });
});

describe("licence cap and owner approval (spec D11)", () => {
  it("the next child past the cap waits for the owner; nobody else can approve", async () => {
    await owner`update branch set licensed_capacity = 1 where id = ${branchA}`;
    try {
      await app.begin(async (tx) => {
        await tx`select set_config('app.user_id', ${users.front_deskA}, true)`;
        const [s] = await tx`
          insert into student (branch_id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id)
          values (${branchA}, ${`${run}-cap`}, 'x', 'Over cap', ${monthsAgo(16)}, 'male', ${kidA.family}) returning id`;
        await expectError(
          tx,
          (sp) => sp`insert into enrollment (student_id, branch_id, room_id, start_date, status) values (${s.id}, ${branchA}, ${roomA2}, ${today()}, 'active')`,
          { message: "over_capacity" },
        );
        const [e] = await tx`insert into enrollment (student_id, branch_id, room_id, start_date, status)
                             values (${s.id}, ${branchA}, ${roomA2}, ${today()}, 'pending_approval') returning id`;
        const [r] = await tx`insert into approval_request (branch_id, type, student_id, enrollment_id, reason)
                             values (${branchA}, 'over_capacity', ${s.id}, ${e.id}, 'Sibling of a current child') returning id`;
        // Front desk asked; they cannot decide, and neither can the branch manager.
        await expectError(tx, (sp) => sp`select app_decide_over_capacity(${r.id}, true, 'ok')`, denied);
        await tx`select set_config('app.user_id', ${users.branch_managerA}, true)`;
        await expectError(tx, (sp) => sp`select app_decide_over_capacity(${r.id}, true, 'ok')`, denied);
        await tx`select set_config('app.user_id', ${users.ownerOrg}, true)`;
        await tx`select app_decide_over_capacity(${r.id}, true, 'Approved for this year')`;
        const [after] = await tx`select status from enrollment where id = ${e.id}`;
        expect(after.status).toBe("active");
        const [req] = await tx`select status, decided_by from approval_request where id = ${r.id}`;
        expect(req).toEqual({ status: "approved", decided_by: users.ownerOrg });
        throw new Error("rollback");
      });
    } catch (e) {
      if ((e as Error).message !== "rollback") throw e;
    } finally {
      await owner`update branch set licensed_capacity = 100 where id = ${branchA}`;
    }
  });
});

describe("transfer between branches (spec §8.1)", () => {
  async function requestTransfer(tx: Sql, student: string) {
    await tx`select set_config('app.user_id', ${users.front_deskA}, true)`;
    const [r] = await tx`insert into approval_request (branch_id, type, student_id, to_branch_id, reason)
                         values (${branchA}, 'transfer', ${student}, ${branchB}, 'Family moved') returning id`;
    return r.id as string;
  }

  it("the receiving branch manager accepts; the child keeps one record and history", async () => {
    await as(users.front_deskA, async (tx) => {
      const req = await requestTransfer(tx, kidA.student);
      // The sending side cannot accept its own transfer.
      await tx`select set_config('app.user_id', ${users.branch_managerA}, true)`;
      await expectError(tx, (sp) => sp`select app_decide_transfer(${req}, true, ${roomA}, ${today()}, null, null)`, denied);

      // The receiving manager can see who is coming before deciding.
      await tx`select set_config('app.user_id', ${users.managerB}, true)`;
      expect(await tx`select full_name_en from student where id = ${kidA.student}`).toEqual([{ full_name_en: "Child A" }]);
      expect(await tx`select 1 from student_medical where student_id = ${kidA.student}`).toHaveLength(0);
      await tx`select app_decide_transfer(${req}, true, ${roomB}, ${today()}, 'Welcome', null)`;
      const enrollments = await tx`select branch_id, status from enrollment where student_id = ${kidA.student} order by created_at`;
      expect(enrollments).toEqual([
        { branch_id: branchA, status: "transferred" },
        { branch_id: branchB, status: "active" },
      ]);
      const [s] = await tx`select branch_id, family_id from student where id = ${kidA.student}`;
      expect(s).toEqual({ branch_id: branchB, family_id: kidA.family });
      const [m] = await tx`select branch_id from student_medical where student_id = ${kidA.student}`;
      expect(m.branch_id).toBe(branchB);

      // Branch A staff no longer see the child.
      await tx`select set_config('app.user_id', ${users.front_deskA}, true)`;
      expect(await tx`select 1 from student where id = ${kidA.student}`).toHaveLength(0);
    });
  });

  it("when a brother or sister stays, the family account is copied", async () => {
    const sib = await seedChild(branchA, roomA2, "sib", { family: kidA.family });
    await as(users.front_deskA, async (tx) => {
      const req = await requestTransfer(tx, kidA.student);
      await tx`select set_config('app.user_id', ${users.managerB}, true)`;
      await tx`select app_decide_transfer(${req}, true, ${roomB}, ${today()}, null, null)`;
      const [moved] = await tx`select s.branch_id, s.family_id, f.branch_id as family_branch
                               from student s join family f on f.id = s.family_id where s.id = ${kidA.student}`;
      expect(moved.branch_id).toBe(branchB);
      expect(moved.family_branch).toBe(branchB);
      expect(moved.family_id).not.toBe(kidA.family);
      const guardians = await tx`select g.branch_id from student_guardian sg join guardian g on g.id = sg.guardian_id where sg.student_id = ${kidA.student}`;
      expect(guardians).toEqual([{ branch_id: branchB }]);
    });
    const [stays] = await owner`select branch_id, family_id from student where id = ${sib.student}`;
    expect(stays).toEqual({ branch_id: branchA, family_id: kidA.family });
  });
});

describe("spreadsheet import rollback (rule 13)", () => {
  it("company manager can add rows only through an import batch and remove them again", async () => {
    await as(users.companyOrg, async (tx) => {
      await expectError(
        tx,
        (sp) => sp`insert into family (branch_id, account_no, display_name) values (${branchA}, ${`${run}-noimport`}, 'x')`,
        denied,
      );
      const [b] = await tx`insert into import_batch (branch_id, kind, file_name, row_count) values (${branchA}, 'children', 'kids.xlsx', 1) returning id`;
      const [f] = await tx`insert into family (branch_id, account_no, display_name, import_batch_id) values (${branchA}, ${`${run}-imp`}, 'Imported', ${b.id}) returning id`;
      expect((await tx`delete from family where id = ${f.id}`).count).toBe(1);
      // Rows typed in by hand are never removed by a rollback.
      expect((await tx`delete from family where id = ${kidB.family}`).count).toBe(0);
    });
  });

  it("one-step rollback removes everything the batch added, and only for the importer", async () => {
    await as(users.companyOrg, async (tx) => {
      const [b] = await tx`insert into import_batch (branch_id, kind, file_name, row_count) values (${branchA}, 'children', 'kids.xlsx', 1) returning id`;
      const [f] = await tx`insert into family (branch_id, account_no, display_name, import_batch_id) values (${branchA}, ${`${run}-rb`}, 'Imported', ${b.id}) returning id`;
      const [g] = await tx`insert into guardian (family_id, branch_id, full_name, relationship, phone, import_batch_id) values (${f.id}, ${branchA}, 'Mona', 'mother', '01012345678', ${b.id}) returning id`;
      const [s] = await tx`insert into student (branch_id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id, import_batch_id)
                           values (${branchA}, ${`${run}-rb1`}, 'x', 'Imported kid', ${monthsAgo(20)}, 'male', ${f.id}, ${b.id}) returning id`;
      await tx`insert into student_guardian (student_id, guardian_id, branch_id) values (${s.id}, ${g.id}, ${branchA})`;
      await tx`insert into consent_record (student_id, guardian_id, branch_id, purpose, granted_on) values (${s.id}, ${g.id}, ${branchA}, 'records', ${monthsAgo(3)})`;
      await tx`insert into enrollment (student_id, branch_id, room_id, start_date, status, import_batch_id) values (${s.id}, ${branchA}, ${roomA}, ${monthsAgo(2)}, 'active', ${b.id})`;

      await tx`select set_config('app.user_id', ${users.front_deskA}, true)`;
      await expectError(tx, (sp) => sp`select app_rollback_import(${b.id})`, denied);

      await tx`select set_config('app.user_id', ${users.companyOrg}, true)`;
      const [{ n }] = await tx`select app_rollback_import(${b.id}) as n`;
      expect(n).toBe(1);
      expect(await tx`select 1 from student where id = ${s.id}`).toHaveLength(0);
      expect(await tx`select 1 from family where id = ${f.id}`).toHaveLength(0);
      expect(await tx`select 1 from enrollment where student_id = ${s.id}`).toHaveLength(0);
      const [batch] = await tx`select status from import_batch where id = ${b.id}`;
      expect(batch.status).toBe("rolled_back");
      await expectError(tx, (sp) => sp`select app_rollback_import(${b.id})`, { message: "not_pending" });
    });
  });

  it("front desk cannot delete children", async () => {
    await as(users.front_deskA, async (tx) => {
      expect((await tx`delete from student where branch_id = ${branchA}`).count).toBe(0);
    });
  });
});
