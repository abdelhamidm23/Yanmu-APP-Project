/**
 * Phase 3 database rules: roll call, check-out to approved adults, staff records, rosters,
 * fingerprint punches and ratio snapshots (spec §5, §8.2, §8.3). Branch isolation for every new table.
 * Run with `pnpm test:db` against a migrated, seeded database.
 */
import "dotenv/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/roles";

const owner = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 2, onnotice: () => {} });
const app = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });

type Sql = postgres.TransactionSql;
const run = `att-${Date.now()}`;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
let branchA: string;
let branchB: string;
let roomA: string;
let roomA2: string;
let roomB: string;
const users: Record<string, string> = {};
const A = { student: "", mum: "", stranger: "", staff: "" };
const A2 = { student: "" };
const B = { student: "", mum: "", staff: "", punch: "", batch: "", card: "" };

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

async function expectError(tx: Sql, statement: (sp: Sql) => Promise<unknown>, match: Record<string, string>) {
  await expect(tx.savepoint((sp) => statement(sp))).rejects.toMatchObject(match);
}
const denied = { code: "42501" };

/** A child with one approved parent (can pick up) and, optionally, a relative who may not. */
async function seedChild(branch: string, room: string, label: string) {
  const [f] = await owner`insert into family (branch_id, account_no, display_name) values (${branch}, ${`${run}-${label}`}, ${label}) returning id`;
  const [mum] = await owner`insert into guardian (family_id, branch_id, full_name, relationship, phone) values (${f.id}, ${branch}, 'Mum', 'mother', '01000000000') returning id`;
  const [uncle] = await owner`insert into guardian (family_id, branch_id, full_name, relationship, phone) values (${f.id}, ${branch}, 'Uncle', 'relative', '01000000001') returning id`;
  const [s] = await owner`
    insert into student (branch_id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id)
    values (${branch}, ${`${run}-${label}`}, 'طفل', ${`Child ${label}`}, ${"2025-03-01"}, 'male', ${f.id}) returning id`;
  await owner`insert into student_guardian (student_id, guardian_id, branch_id, can_pick_up) values (${s.id}, ${mum.id}, ${branch}, true)`;
  await owner`insert into student_guardian (student_id, guardian_id, branch_id, can_pick_up) values (${s.id}, ${uncle.id}, ${branch}, false)`;
  await owner`insert into enrollment (student_id, branch_id, room_id, start_date, status) values (${s.id}, ${branch}, ${room}, '2026-01-01', 'active')`;
  return { student: s.id as string, mum: mum.id as string, stranger: uncle.id as string };
}

const mark = (tx: Sql, student: string, status = "present") =>
  tx`insert into student_attendance (branch_id, room_id, student_id, date, status, check_in_at)
     values (${branchA}, ${roomA}, ${student}, ${today}, ${status}, ${status === "present" ? new Date() : null}) returning branch_id, room_id`;

beforeAll(async () => {
  const [{ id: orgId }] = await owner`select id from organization limit 1`;
  const [{ id: toddlers }] = await owner`select id from age_band where key = 'toddlers'`;
  [{ id: branchA }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'أ', 'Att A', ${`${run}A`}) returning id`;
  [{ id: branchB }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'ب', 'Att B', ${`${run}B`}) returning id`;
  const room = async (branch: string, name: string) =>
    (await owner`insert into room (branch_id, name_ar, name_en, age_band_id, capacity) values (${branch}, ${name}, ${name}, ${toddlers}, 12) returning id`)[0].id as string;
  roomA = await room(branchA, "Toddlers A");
  roomA2 = await room(branchA, "Toddlers A2");
  roomB = await room(branchB, "Toddlers B");

  for (const role of ROLES) users[`${role}A`] = await makeUser(`${role}-A`, [[role, branchA]]);
  users.hrOrg = await makeUser("hr-org", [["hr", null]]);
  users.companyOrg = await makeUser("company-org", [["company_manager", null]]);
  await owner`insert into user_room (user_id, room_id, branch_id) values (${users.teacherA}, ${roomA}, ${branchA})`;

  Object.assign(A, await seedChild(branchA, roomA, "A"));
  A2.student = (await seedChild(branchA, roomA2, "A2")).student;
  Object.assign(B, await seedChild(branchB, roomB, "B"));

  [{ id: A.staff }] = await owner`
    insert into staff (branch_id, user_id, full_name_ar, full_name_en, job_title, default_room_id, device_employee_no)
    values (${branchA}, ${users.teacherA}, 'مربية', 'Carer A', 'Carer', ${roomA}, '7') returning id`;
  [{ id: B.staff }] = await owner`
    insert into staff (branch_id, full_name_ar, full_name_en, job_title, default_room_id, device_employee_no)
    values (${branchB}, 'مربية', 'Carer B', 'Carer', ${roomB}, '8') returning id`;
  [{ id: B.batch }] = await owner`insert into import_batch (branch_id, kind, file_name, row_count) values (${branchB}, 'staff_punches', 'b.xlsx', 1) returning id`;
  [{ id: B.punch }] = await owner`
    insert into staff_punch (branch_id, staff_id, device_employee_no, punched_at, import_batch_id) values (${branchB}, ${B.staff}, '8', now(), ${B.batch}) returning id`;
  await owner`insert into staff_attendance_day (staff_id, date, branch_id, status) values (${B.staff}, ${today}, ${branchB}, 'present')`;
  await owner`insert into room_roster (staff_id, date, branch_id, room_id, marked_present) values (${B.staff}, ${today}, ${branchB}, ${roomB}, true)`;
  await owner`insert into student_attendance (branch_id, room_id, student_id, date, status) values (${branchB}, ${roomB}, ${B.student}, ${today}, 'present')`;
  await owner`insert into pickup_refusal (branch_id, student_id, person_name, happened_at) values (${branchB}, ${B.student}, 'Someone', now())`;
  await owner`insert into import_mapping (branch_id, kind, mapping) values (${branchB}, 'staff_punches', '{"employeeNo":"ID"}')`;
  [{ id: B.card }] = await owner`insert into pickup_card (branch_id, guardian_id, token_hash) values (${branchB}, ${B.mum}, ${`hash-${run}-B`}) returning id`;
  await owner`insert into ratio_snapshot (branch_id, room_id, children_present, carers_present, required_carers, is_breach, reason)
              values (${branchB}, ${roomB}, 1, 1, 1, false, 'test')`;
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

describe.each(ROLES.map((r) => [r] as const))("%s in Branch A cannot reach Branch B attendance or staff", (role) => {
  const me = () => users[`${role}A`];

  it("reads nothing of Branch B", async () => {
    await as(me(), async (tx) => {
      for (const table of ["staff", "room_roster", "student_attendance", "pickup_refusal", "staff_punch", "staff_attendance_day", "import_mapping", "ratio_snapshot", "pickup_card"]) {
        expect(await tx`select 1 from ${tx(table)} where branch_id = ${branchB}`, table).toHaveLength(0);
      }
      expect(await tx`select 1 from import_batch where id = ${B.batch}`).toHaveLength(0);
    });
  });

  it("changes nothing in Branch B", async () => {
    await as(me(), async (tx) => {
      await expectError(tx, (sp) => sp`insert into student_attendance (branch_id, room_id, student_id, date, status) values (${branchB}, ${roomB}, ${B.student}, ${"2026-01-05"}, 'present')`, denied);
      await expectError(tx, (sp) => sp`insert into staff (branch_id, full_name_ar, full_name_en, job_title) values (${branchB}, 'x', 'x', 'x')`, denied);
      await expectError(tx, (sp) => sp`insert into staff_punch (branch_id, device_employee_no, punched_at) values (${branchB}, '99', now())`, denied);
      await expectError(tx, (sp) => sp`insert into room_roster (staff_id, date, branch_id, room_id) values (${B.staff}, ${"2026-01-05"}, ${branchB}, ${roomB})`, denied);
      await expectError(tx, (sp) => sp`insert into pickup_refusal (branch_id, student_id, happened_at) values (${branchB}, ${B.student}, now())`, denied);
      await expectError(tx, (sp) => sp`insert into import_batch (branch_id, kind, file_name, row_count) values (${branchB}, 'staff_punches', 'x', 1)`, denied);
      await expectError(tx, (sp) => sp`select app_set_staff_device_no(${B.staff}, '1')`, denied);
      await expectError(tx, (sp) => sp`select app_take_ratio_snapshot(${roomB}, 'test')`, denied);
      expect((await tx`update student_attendance set status = 'absent' where branch_id = ${branchB}`).count).toBe(0);
      expect((await tx`update staff set job_title = 'x' where id = ${B.staff}`).count).toBe(0);
      expect((await tx`delete from staff_punch where id = ${B.punch}`).count).toBe(0);
      expect((await tx`delete from staff_attendance_day where branch_id = ${branchB}`).count).toBe(0);
      await expectError(tx, (sp) => sp`insert into pickup_card (branch_id, guardian_id, token_hash) values (${branchB}, ${B.mum}, ${`x-${run}-${role}`})`, denied);
      // The card's branch comes from the adult, so naming your own branch does not help either.
      await expectError(tx, (sp) => sp`insert into pickup_card (branch_id, guardian_id, token_hash) values (${branchA}, ${B.mum}, ${`y-${run}-${role}`})`, denied);
      expect((await tx`update pickup_card set revoked_at = now() where id = ${B.card}`).count).toBe(0);
    });
  });
});

describe("roll call (spec §8.2)", () => {
  it("branch and room come from the child's enrollment, and an unenrolled child is refused", async () => {
    await as(users.front_deskA, async (tx) => {
      const [row] = await tx`insert into student_attendance (branch_id, room_id, student_id, date, status)
                             values (${branchA}, ${roomA2}, ${A.student}, ${today}, 'present') returning branch_id, room_id`;
      expect(row).toEqual({ branch_id: branchA, room_id: roomA });
      await tx`update enrollment set status = 'withdrawn', end_date = ${today}, end_reason = 'test' where student_id = ${A2.student}`;
      await expectError(tx, (sp) => mark(sp, A2.student), { message: "not_enrolled" });
    });
  });

  it("a teacher marks only the children in the rooms they look after, and sees only those", async () => {
    await as(users.teacherA, async (tx) => {
      await mark(tx, A.student);
      await expectError(tx, (sp) => mark(sp, A2.student), denied);
      await owner`insert into student_attendance (branch_id, room_id, student_id, date, status) values (${branchA}, ${roomA2}, ${A2.student}, ${"2026-01-04"}, 'absent')
                  on conflict do nothing`;
      expect(await tx`select 1 from student_attendance where student_id = ${A2.student}`).toHaveLength(0);
      expect(await tx`select 1 from student_attendance where student_id = ${A.student}`).toHaveLength(1);
    });
  });

  it("accountant and HR cannot see or take roll call", async () => {
    for (const who of [users.accountantA, users.hrA]) {
      await as(who, async (tx) => {
        await expectError(tx, (sp) => mark(sp, A.student), denied);
      });
    }
  });

  it("a row cannot be moved to another child, day or branch", async () => {
    await as(users.branch_managerA, async (tx) => {
      const [{ id }] = await tx`insert into student_attendance (branch_id, room_id, student_id, date, status)
                                values (${branchA}, ${roomA}, ${A.student}, ${"2026-01-06"}, 'present') returning id`;
      const [after] = await tx`update student_attendance set student_id = ${A2.student}, date = ${"2026-01-07"}, branch_id = ${branchB} where id = ${id}
                               returning student_id, date, branch_id`;
      expect(after.student_id).toBe(A.student);
      expect(after.branch_id).toBe(branchA);
    });
  });

  it("check-out only to an adult on the pickup list, and only for a child who is present", async () => {
    await as(users.teacherA, async (tx) => {
      await mark(tx, A.student, "absent");
      await expectError(
        tx,
        (sp) => sp`update student_attendance set check_out_at = now(), collected_by_guardian_id = ${A.mum} where student_id = ${A.student} and date = ${today}`,
        { message: "not_checked_in" },
      );
      await tx`update student_attendance set status = 'present', check_in_at = now() where student_id = ${A.student} and date = ${today}`;
      await expectError(
        tx,
        (sp) => sp`update student_attendance set check_out_at = now(), collected_by_guardian_id = ${A.stranger} where student_id = ${A.student} and date = ${today}`,
        { message: "pickup_not_approved" },
      );
      await expectError(tx, (sp) => sp`update student_attendance set check_out_at = now() where student_id = ${A.student} and date = ${today}`, {
        message: "pickup_not_approved",
      });
      const done = await tx`update student_attendance set check_out_at = now(), collected_by_guardian_id = ${A.mum} where student_id = ${A.student} and date = ${today}`;
      expect(done.count).toBe(1);
    });
  });

  it("a refused pickup is recorded by the teacher and acknowledged only by the branch manager", async () => {
    await as(users.teacherA, async (tx) => {
      const [r] = await tx`insert into pickup_refusal (branch_id, student_id, person_name, happened_at) values (${branchB}, ${A.student}, 'Uncle', now()) returning id, branch_id`;
      expect(r.branch_id).toBe(branchA);
      expect((await tx`update pickup_refusal set acknowledged_at = now() where id = ${r.id}`).count).toBe(0);
      await expectError(tx, (sp) => sp`insert into pickup_refusal (branch_id, student_id, happened_at) values (${branchA}, ${A2.student}, now())`, denied);
    });
    await as(users.branch_managerA, async (tx) => {
      const [r] = await tx`insert into pickup_refusal (branch_id, student_id, happened_at) values (${branchA}, ${A.student}, now()) returning id`;
      expect((await tx`update pickup_refusal set acknowledged_at = now(), acknowledged_by = ${users.branch_managerA} where id = ${r.id}`).count).toBe(1);
    });
  });

  it("every roll-call change is in the audit log", async () => {
    await as(users.front_deskA, async (tx) => {
      const [{ id }] = await tx`insert into student_attendance (branch_id, room_id, student_id, date, status)
                                values (${branchA}, ${roomA}, ${A.student}, ${"2026-01-08"}, 'present') returning id`;
      await tx`update student_attendance set status = 'absent' where id = ${id}`;
      // The audit log is read by organization admins; switch to one inside the same (rolled back) transaction.
      await tx`select set_config('app.user_id', ${users.companyOrg}, true)`;
      const rows = await tx`select action, actor_user_id from audit_event where table_name = 'student_attendance' and row_id = ${id} order by at, action`;
      expect(rows.map((r) => r.action).sort()).toEqual(["insert", "update"]);
      expect(rows.every((r) => r.actor_user_id === users.front_deskA)).toBe(true);
    });
  });
});

describe("staff, roster and fingerprint files (spec §8.3)", () => {
  it("only HR adds or edits staff records; the branch manager reads them", async () => {
    await as(users.hrA, async (tx) => {
      await tx`insert into staff (branch_id, full_name_ar, full_name_en, job_title) values (${branchA}, 'س', 'New', 'Carer')`;
      expect((await tx`update staff set job_title = 'Lead' where id = ${A.staff}`).count).toBe(1);
      await expectError(tx, (sp) => sp`insert into staff (branch_id, full_name_ar, full_name_en, job_title, default_room_id) values (${branchA}, 'س', 'X', 'Carer', ${roomB})`, {
        message: "room belongs to another branch",
      });
    });
    await as(users.branch_managerA, async (tx) => {
      expect(await tx`select 1 from staff where id = ${A.staff}`).toHaveLength(1);
      await expectError(tx, (sp) => sp`insert into staff (branch_id, full_name_ar, full_name_en, job_title) values (${branchA}, 'س', 'X', 'Carer')`, denied);
      expect((await tx`update staff set job_title = 'x' where id = ${A.staff}`).count).toBe(0);
    });
  });

  it("a teacher sees their own staff row only; front desk sees none", async () => {
    await as(users.teacherA, async (tx) => {
      expect((await tx`select id from staff where branch_id = ${branchA}`).map((r) => r.id)).toEqual([A.staff]);
    });
    await as(users.front_deskA, async (tx) => {
      expect(await tx`select 1 from staff where branch_id = ${branchA}`).toHaveLength(0);
    });
  });

  it("the branch manager moves people between rooms for the day; front desk cannot", async () => {
    await as(users.branch_managerA, async (tx) => {
      const [r] = await tx`insert into room_roster (staff_id, date, branch_id, room_id, marked_present) values (${A.staff}, ${today}, ${branchB}, ${roomA2}, true) returning branch_id`;
      expect(r.branch_id).toBe(branchA);
      await expectError(tx, (sp) => sp`update room_roster set room_id = ${roomB} where staff_id = ${A.staff} and date = ${today}`, { message: "room belongs to another branch" });
    });
    await as(users.front_deskA, async (tx) => {
      await expectError(tx, (sp) => sp`insert into room_roster (staff_id, date, branch_id, room_id) values (${A.staff}, ${today}, ${branchA}, ${roomA})`, denied);
    });
  });

  it("fingerprint batches: HR and the branch manager upload them, the children importer does not", async () => {
    await as(users.hrOrg, async (tx) => {
      await tx`insert into import_batch (branch_id, kind, file_name, row_count) values (${branchA}, 'staff_punches', 'f.xlsx', 1)`;
      await expectError(tx, (sp) => sp`insert into import_batch (branch_id, kind, file_name, row_count) values (${branchA}, 'children', 'c.xlsx', 1)`, denied);
    });
    await as(users.companyOrg, async (tx) => {
      await tx`insert into import_batch (branch_id, kind, file_name, row_count) values (${branchA}, 'children', 'c.xlsx', 1)`;
      await expectError(tx, (sp) => sp`insert into import_batch (branch_id, kind, file_name, row_count) values (${branchA}, 'staff_punches', 'f.xlsx', 1)`, denied);
    });
  });

  it("a punch cannot be pinned on a person in another branch", async () => {
    await as(users.hrOrg, async (tx) => {
      await expectError(tx, (sp) => sp`insert into staff_punch (branch_id, staff_id, device_employee_no, punched_at) values (${branchA}, ${B.staff}, '8', now())`, {
        message: "staff belongs to another branch",
      });
    });
  });

  it("linking a fingerprint number attaches that number's punches to the person", async () => {
    await as(users.branch_managerA, async (tx) => {
      await tx`insert into staff_punch (branch_id, device_employee_no, punched_at) values (${branchA}, '55', now() - interval '1 day')`;
      const [{ n }] = await tx`select app_set_staff_device_no(${A.staff}, '55') as n`;
      expect(n).toBe(1);
      expect(await tx`select 1 from staff_punch where staff_id = ${A.staff} and device_employee_no = '55'`).toHaveLength(1);
    });
    await as(users.front_deskA, async (tx) => {
      await expectError(tx, (sp) => sp`select app_set_staff_device_no(${A.staff}, '56')`, denied);
    });
  });

  it("ratio snapshots: a breach is recorded, and an unchanged room is not recorded twice", async () => {
    const kids: { student: string }[] = [];
    for (let i = 0; i < 5; i++) kids.push(await seedChild(branchA, roomA, `R${i}`));
    await as(users.branch_managerA, async (tx) => {
      // Five children present, 1:4 → two carers needed; only the one carer is rostered and present.
      for (const kid of kids) {
        await tx`insert into student_attendance (branch_id, room_id, student_id, date, status, check_in_at) values (${branchA}, ${roomA}, ${kid.student}, ${today}, 'present', now())`;
      }
      await tx`insert into room_roster (staff_id, date, branch_id, room_id, marked_present) values (${A.staff}, ${today}, ${branchA}, ${roomA}, true)
               on conflict (staff_id, date) do update set room_id = excluded.room_id, marked_present = true`;
      await tx`select app_take_ratio_snapshot(${roomA}, 'test')`;
      await tx`select app_take_ratio_snapshot(${roomA}, 'test')`;
      const snaps = await tx`select children_present, carers_present, required_carers, is_breach from ratio_snapshot where room_id = ${roomA}`;
      expect(snaps).toEqual([{ children_present: 5, carers_present: 1, required_carers: 2, is_breach: true }]);
    });
    await as(users.teacherA, async (tx) => {
      // A teacher may trigger the check for their own room but not read the history.
      await tx`select app_take_ratio_snapshot(${roomA}, 'roll_call')`;
      expect(await tx`select 1 from ratio_snapshot where room_id = ${roomA}`).toHaveLength(0);
      await expectError(tx, (sp) => sp`select app_take_ratio_snapshot(${roomA2}, 'roll_call')`, denied);
    });
  });
});

describe("Pickup links and daily pickup codes (owner's review of phase 3)", () => {
  it("front desk and the branch manager make and cancel pickup links; teachers and accountants only read them", async () => {
    await as(users.front_deskA, async (tx) => {
      const [c] = await tx`insert into pickup_card (branch_id, guardian_id, token_hash) values (${branchB}, ${A.mum}, ${`fd-${run}`}) returning id, branch_id`;
      expect(c.branch_id).toBe(branchA);
      expect((await tx`update pickup_card set revoked_at = now() where id = ${c.id}`).count).toBe(1);
      const [after] = await tx`select revoked_by from pickup_card where id = ${c.id}`;
      expect(after.revoked_by).toBe(users.front_deskA);
    });
    for (const who of ["teacherA", "accountantA", "hrA"]) {
      await as(users[who], async (tx) => {
        await expectError(tx, (sp) => sp`insert into pickup_card (branch_id, guardian_id, token_hash) values (${branchA}, ${A.mum}, ${`${who}-${run}`})`, denied);
      });
    }
  });

  it("one link in use per adult; the secret and the adult never change, and a cancelled link stays cancelled", async () => {
    await as(users.branch_managerA, async (tx) => {
      const [c] = await tx`insert into pickup_card (branch_id, guardian_id, token_hash) values (${branchA}, ${A.mum}, ${`bm-${run}`}) returning id`;
      await expectError(tx, (sp) => sp`insert into pickup_card (branch_id, guardian_id, token_hash) values (${branchA}, ${A.mum}, ${`bm2-${run}`})`, { code: "23505" });
      await expectError(tx, (sp) => sp`update pickup_card set token_hash = 'other' where id = ${c.id}`, { code: "23514" });
      await expectError(tx, (sp) => sp`update pickup_card set guardian_id = ${A.stranger} where id = ${c.id}`, { code: "23514" });
      await tx`update pickup_card set revoked_at = now() where id = ${c.id}`;
      await expectError(tx, (sp) => sp`update pickup_card set revoked_at = null where id = ${c.id}`, { code: "23514" });
      expect((await tx`delete from pickup_card where id = ${c.id}`.catch(() => ({ count: -1 }))).count).not.toBe(1);
    });
  });

  it("a teacher sees links only for adults of children in their classes", async () => {
    const [{ id: a2mum }] = await owner`select sg.guardian_id as id from student_guardian sg where sg.student_id = ${A2.student} and sg.can_pick_up`;
    await owner`insert into pickup_card (branch_id, guardian_id, token_hash) values (${branchA}, ${A.mum}, ${`t1-${run}`})`;
    await owner`insert into pickup_card (branch_id, guardian_id, token_hash) values (${branchA}, ${a2mum}, ${`t2-${run}`})`;
    await as(users.teacherA, async (tx) => {
      const rows = await tx`select token_hash from pickup_card where branch_id = ${branchA}`;
      expect(rows.map((r) => r.token_hash)).toEqual([`t1-${run}`]);
    });
    await owner`delete from pickup_card where token_hash in (${`t1-${run}`}, ${`t2-${run}`})`;
  });

  it("the audit log records links without their secret", async () => {
    await as(users.front_deskA, async (tx) => {
      const [{ id }] = await tx`insert into pickup_card (branch_id, guardian_id, token_hash) values (${branchA}, ${A.mum}, ${`audit-${run}`}) returning id`;
      await tx`select set_config('app.user_id', ${users.companyOrg}, true)`;
      const [row] = await tx`select after from audit_event where table_name = 'pickup_card' and row_id = ${id}`;
      expect(row.after.guardian_id).toBe(A.mum);
      expect(row.after).not.toHaveProperty("token_hash");
    });
  });

  it("check-out records whether a pickup QR or the list was used", async () => {
    await as(users.teacherA, async (tx) => {
      await mark(tx, A.student);
      await expectError(
        tx,
        (sp) => sp`update student_attendance set check_out_at = now(), collected_by_guardian_id = ${A.mum}, check_out_method = 'phone' where student_id = ${A.student} and date = ${today}`,
        { code: "23514" },
      );
      const done = await tx`update student_attendance set check_out_at = now(), collected_by_guardian_id = ${A.mum}, check_out_method = 'qr' where student_id = ${A.student} and date = ${today}`;
      expect(done.count).toBe(1);
    });
  });

  it("a link page shows only the children of that link's adult, and nothing once cancelled", async () => {
    const hash = `link-${run}`;
    const [{ id }] = await owner`insert into pickup_card (branch_id, guardian_id, token_hash) values (${branchA}, ${A.mum}, ${hash}) returning id`;
    // The page is opened without signing in: the app role, no user set.
    const rows = await app`select * from app_pickup_link_children(${hash})`;
    expect(rows.map((r) => r.student_id)).toEqual([A.student]);
    expect(Object.keys(rows[0]).sort()).toEqual(["branch_name_ar", "branch_name_en", "full_name_ar", "full_name_en", "guardian_name", "pickup_code_version", "student_id"]);
    expect(await app`select * from app_pickup_link_children(${"no-such-link"})`).toHaveLength(0);
    // Without the function, the app role sees no children and no links.
    expect(await app`select id from student where id = ${A.student}`).toHaveLength(0);
    expect(await app`select id from pickup_card where id = ${id}`).toHaveLength(0);
    await owner`update pickup_card set revoked_at = now() where id = ${id}`;
    expect(await app`select * from app_pickup_link_children(${hash})`).toHaveLength(0);
  });

  it("an adult who may no longer collect gets nothing on their link", async () => {
    const hash = `stop-${run}`;
    await owner`insert into pickup_card (branch_id, guardian_id, token_hash) values (${branchA}, ${A.mum}, ${hash})`;
    await owner`update student_guardian set can_pick_up = false where student_id = ${A.student} and guardian_id = ${A.mum}`;
    try {
      expect(await app`select * from app_pickup_link_children(${hash})`).toHaveLength(0);
    } finally {
      await owner`update student_guardian set can_pick_up = true where student_id = ${A.student} and guardian_id = ${A.mum}`;
      await owner`update pickup_card set revoked_at = now() where token_hash = ${hash}`;
    }
  });

  it("only the child's own branch manager or front desk can give a new code for today", async () => {
    const [before] = await owner`select pickup_code_version as v from student where id = ${A.student}`;
    for (const who of ["front_deskA", "branch_managerA"]) {
      await as(users[who], async (tx) => {
        const [row] = await tx`update student set pickup_code_version = pickup_code_version + 1 where id = ${A.student} returning pickup_code_version as v`;
        expect(row.v).toBe(before.v + 1);
      });
    }
    // Another branch's child: not even the front desk of this branch.
    await as(users.front_deskA, async (tx) => {
      const out = await tx.savepoint((sp) => sp`update student set pickup_code_version = pickup_code_version + 1 where id = ${B.student}`).catch(() => ({ count: 0 }));
      expect(out.count).toBe(0);
    });
    for (const who of ["teacherA", "accountantA", "hrA"]) {
      await as(users[who], async (tx) => {
        const out = await tx.savepoint((sp) => sp`update student set pickup_code_version = pickup_code_version + 1 where id = ${A.student}`).catch(() => ({ count: 0 }));
        expect(out.count).toBe(0);
      });
    }
  });
});
