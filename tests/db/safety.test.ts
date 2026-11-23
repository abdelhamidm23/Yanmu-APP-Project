/**
 * Phase 5 database rules (spec §5, §8.7, §8.8, §10): incidents and issues stay in their branch,
 * a critical incident alerts everyone at once and stops when one person acknowledges it, same-day
 * alerts climb step by step, reports go reporter → company manager → owner, issues are assigned only
 * by managers, and nobody reads anyone else's alerts or phones.
 * Run with `pnpm test:db` against a migrated, seeded database.
 */
import "dotenv/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/roles";

const owner = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 2, onnotice: () => {} });
const app = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });

type Sql = postgres.TransactionSql;
const run = `safety-${Date.now()}`;
const code = `S${Date.now().toString(36).toUpperCase()}`;
let orgId: string;
let branchA: string;
let branchB: string;
let roomA: string;
let roomA2: string;
let roomB: string;
let studentA: string;
const users: Record<string, string> = {};

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

async function commitAs<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  })) as T;
}

/** The alert job: runs with no user set, as the server's cron does. */
const job = () => app.begin((tx) => tx`select app_run_alerts() as n`);

async function expectError(tx: Sql, statement: (sp: Sql) => Promise<unknown>, match: Record<string, string>) {
  await expect(tx.savepoint((sp) => statement(sp))).rejects.toMatchObject(match);
}
const denied = { code: "42501" };

const newIncident = (tx: Sql, branch: string, room: string | null, category = "injury", severity = "minor") => tx`
  insert into incident (branch_id, room_id, occurred_at, category, severity, description, immediate_action)
  values (${branch}, ${room}, now() - interval '5 minutes', ${category}, ${severity}, 'Fell in the yard', 'Ice pack') returning id, severity, status`;

const notified = async (alertId: string) =>
  (await owner`select user_id from notification where alert_id = ${alertId}`).map((r) => r.user_id as string);

beforeAll(async () => {
  [{ id: orgId }] = await owner`select id from organization limit 1`;
  [{ id: branchA }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'أ', 'Safety A', ${code + "A"}) returning id`;
  [{ id: branchB }] = await owner`insert into branch (org_id, name_ar, name_en, code) values (${orgId}, 'ب', 'Safety B', ${code + "B"}) returning id`;
  const [{ id: band }] = await owner`select id from age_band where key = 'toddlers'`;
  [{ id: roomA }] = await owner`insert into room (branch_id, name_ar, name_en, age_band_id, capacity) values (${branchA}, 'ت', 'A1', ${band}, 12) returning id`;
  [{ id: roomA2 }] = await owner`insert into room (branch_id, name_ar, name_en, age_band_id, capacity) values (${branchA}, 'ت', 'A2', ${band}, 12) returning id`;
  [{ id: roomB }] = await owner`insert into room (branch_id, name_ar, name_en, age_band_id, capacity) values (${branchB}, 'ت', 'B1', ${band}, 12) returning id`;
  const [f] = await owner`insert into family (branch_id, account_no, display_name) values (${branchA}, ${run}, 'Fam') returning id`;
  [{ id: studentA }] = await owner`
    insert into student (branch_id, student_no, full_name_ar, full_name_en, date_of_birth, gender, family_id)
    values (${branchA}, ${run}, 'طفل', 'Child A', '2025-03-01', 'male', ${f.id}) returning id`;
  await owner`insert into enrollment (student_id, branch_id, room_id, start_date, status) values (${studentA}, ${branchA}, ${roomA}, '2026-01-01', 'active')`;

  for (const role of ROLES) {
    users[`${role}A`] = await makeUser(`${role}-A`, [[role, branchA]]);
    users[`${role}B`] = await makeUser(`${role}-B`, [[role, branchB]]);
  }
  users.teacherA2 = await makeUser("teacher-A2", [["teacher", branchA]]);
  await owner`insert into user_room (user_id, room_id, branch_id) values (${users.teacherA}, ${roomA}, ${branchA})`;
  await owner`insert into user_room (user_id, room_id, branch_id) values (${users.teacherA2}, ${roomA2}, ${branchA})`;
  await owner`insert into user_room (user_id, room_id, branch_id) values (${users.teacherB}, ${roomB}, ${branchB})`;
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

describe("incidents stay in their branch", () => {
  it("a teacher reports for their own class only, and nobody in the other branch sees it", async () => {
    const id = await commitAs(users.teacherA, async (tx) => (await newIncident(tx, branchA, roomA))[0].id as string);
    await as(users.teacherA, async (tx) => {
      await expectError(tx, (sp) => newIncident(sp, branchA, roomA2), denied);
      await expectError(tx, (sp) => newIncident(sp, branchB, roomB), denied);
    });
    for (const u of ["branch_managerB", "company_managerB", "ownerB", "teacherB", "front_deskB", "teacherA2", "accountantA", "hrA"]) {
      const rows = await as(users[u], (tx) => tx`select id from incident where id = ${id}`);
      expect(rows, u).toHaveLength(0);
    }
    for (const u of ["teacherA", "branch_managerA", "company_managerA", "ownerA"]) {
      expect(await as(users[u], (tx) => tx`select id from incident where id = ${id}`), u).toHaveLength(1);
    }
  });

  it("people, actions, photos and issues of another branch cannot be read or written", async () => {
    const id = await commitAs(users.branch_managerA, async (tx) => {
      const [i] = await newIncident(tx, branchA, roomA);
      await tx`insert into incident_person (incident_id, student_id, role) values (${i.id}, ${studentA}, 'injured')`;
      await tx`insert into incident_action (incident_id, description, owner_user_id, due_on) values (${i.id}, 'Fix the step', ${users.branch_managerA}, current_date + 3)`;
      await tx`insert into issue (branch_id, category, title) values (${branchA}, 'maintenance', 'Broken step')`;
      return i.id as string;
    });
    await as(users.branch_managerB, async (tx) => {
      expect(await tx`select 1 from incident_person where incident_id = ${id}`).toHaveLength(0);
      expect(await tx`select 1 from incident_action where incident_id = ${id}`).toHaveLength(0);
      expect(await tx`select 1 from issue where branch_id = ${branchA}`).toHaveLength(0);
      await expectError(tx, (sp) => sp`insert into incident_person (incident_id, person_name, role) values (${id}, 'X', 'witness')`, denied);
      await expectError(tx, (sp) => sp`insert into incident_action (incident_id, description, owner_user_id, due_on) values (${id}, 'x', ${users.branch_managerB}, current_date)`, {
        code: expect.stringMatching(/^(42501|23514)$/) as unknown as string,
      });
      await expectError(tx, (sp) => sp`insert into issue (branch_id, category, title) values (${branchA}, 'it', 'x')`, denied);
      const upd = await tx`update incident set description = 'changed' where id = ${id} returning id`;
      expect(upd).toHaveLength(0);
    });
  });

  it("the status can only move through the database's own steps", async () => {
    const id = await commitAs(users.branch_managerA, async (tx) => (await newIncident(tx, branchA, roomA))[0].id as string);
    await as(users.branch_managerA, async (tx) => {
      await expectError(tx, (sp) => sp`update incident set status = 'closed' where id = ${id}`, denied);
      await expectError(tx, (sp) => sp`delete from incident where id = ${id}`, denied);
    });
  });
});

describe("critical incidents (spec §10)", () => {
  it("head injury is always critical and alerts everyone at once; one 'I'm on it' stops it", async () => {
    const inc = await commitAs(users.teacherA, async (tx) => (await newIncident(tx, branchA, roomA, "head_injury", "minor"))[0]);
    expect(inc.severity).toBe("critical");
    const [alert] = await owner`select id, tier, acknowledged_at from alert where subject_id = ${inc.id} and key = 'critical_incident'`;
    expect(alert.tier).toBe("critical");
    const who = await notified(alert.id);
    for (const u of ["branch_managerA", "company_managerA", "ownerA"]) expect(who, u).toContain(users[u]);
    for (const u of ["branch_managerB", "company_managerB", "ownerB", "accountantA", "teacherA2"]) expect(who, u).not.toContain(users[u]);
    // Push and SMS are queued for each person (sent by the alert job; skipped when not set up).
    const [{ n }] = await owner`select count(*)::int as n from notification_delivery d join notification x on x.id = d.notification_id where x.alert_id = ${alert.id} and d.channel = 'sms'`;
    expect(n).toBe(who.length);

    // Nobody outside the branch can acknowledge it.
    await as(users.branch_managerB, (tx) => expectError(tx, (sp) => sp`select app_ack_alert(${alert.id})`, denied));
    await commitAs(users.branch_managerA, (tx) => tx`select app_ack_alert(${alert.id})`);
    const [after] = await owner`select acknowledged_by from alert where id = ${alert.id}`;
    expect(after.acknowledged_by).toBe(users.branch_managerA);
    // No more repeats once acknowledged.
    await owner`update alert set last_sent_at = now() - interval '1 hour' where id = ${alert.id}`;
    const before = await owner`select send_count from alert where id = ${alert.id}`;
    await job();
    const later = await owner`select send_count from alert where id = ${alert.id}`;
    expect(later[0].send_count).toBe(before[0].send_count);
  });

  it("an unacknowledged critical alert repeats", async () => {
    const inc = await commitAs(users.branch_managerA, async (tx) => (await newIncident(tx, branchA, roomA, "child_unaccounted", "serious"))[0]);
    const [alert] = await owner`select id, send_count from alert where subject_id = ${inc.id} and key = 'critical_incident'`;
    await owner`update alert set last_sent_at = now() - interval '1 hour' where id = ${alert.id}`;
    await job();
    const [after] = await owner`select send_count from alert where id = ${alert.id}`;
    expect(after.send_count).toBeGreaterThan(alert.send_count);
  });

  it("a critical incident cannot be lowered, and only the owner closes it after the review", async () => {
    const id = await commitAs(users.teacherA, async (tx) => {
      const [i] = await newIncident(tx, branchA, roomA, "allergic_reaction", "critical");
      await tx`insert into incident_person (incident_id, student_id, role) values (${i.id}, ${studentA}, 'injured')`;
      return i.id as string;
    });
    await as(users.teacherA, (tx) => expectError(tx, (sp) => sp`update incident set severity = 'minor', category = 'injury' where id = ${id}`, { message: "severity_down" }));
    // The full report needs words and the guardian.
    await as(users.teacherA, (tx) => expectError(tx, (sp) => sp`select app_incident_submit_report(${id})`, { message: "report_required" }));
    await commitAs(users.teacherA, (tx) => tx`update incident set report_details = 'Ate a cake with nuts at the party; epipen given.' where id = ${id}`);
    await as(users.teacherA, (tx) => expectError(tx, (sp) => sp`select app_incident_submit_report(${id})`, { message: "guardian_required" }));
    await commitAs(users.teacherA, async (tx) => {
      await tx`update incident set guardian_notified_at = now(), guardian_notification_note = 'Mother called' where id = ${id}`;
      await tx`select app_incident_submit_report(${id})`;
    });
    // The branch manager cannot review; the company manager can.
    await as(users.branch_managerA, (tx) => expectError(tx, (sp) => sp`select app_incident_review(${id}, 'ok')`, denied));
    await commitAs(users.company_managerA, (tx) => tx`select app_incident_review(${id}, 'Checked')`);
    await as(users.company_managerA, (tx) => expectError(tx, (sp) => sp`select app_incident_close(${id}, 'done')`, { message: "owner_decides" }));
    await as(users.ownerB, (tx) => expectError(tx, (sp) => sp`select app_incident_close(${id}, 'done')`, denied));
    await commitAs(users.ownerA, (tx) => tx`select app_incident_close(${id}, 'Signed off')`);
    const [row] = await owner`select status, closed_by from incident where id = ${id}`;
    expect(row).toMatchObject({ status: "closed", closed_by: users.ownerA });
    // Closed means closed.
    const upd = await as(users.branch_managerA, (tx) => tx`update incident set description = 'x' where id = ${id} returning id`);
    expect(upd).toHaveLength(0);
  });

  it("a refused pickup becomes a critical incident", async () => {
    const [r] = await owner`insert into pickup_refusal (branch_id, student_id, person_name, note) values (${branchA}, ${studentA}, 'Uncle', 'Not on list') returning id`;
    const [inc] = await owner`select id, severity, category from incident where pickup_refusal_id = ${r.id}`;
    expect(inc).toMatchObject({ severity: "critical", category: "pickup_unapproved" });
    const [p] = await owner`select student_id from incident_person where incident_id = ${inc.id}`;
    expect(p.student_id).toBe(studentA);
    expect(await owner`select 1 from alert where subject_id = ${inc.id} and tier = 'critical'`).toHaveLength(1);
  });
});

describe("step-by-step alerts (spec §10)", () => {
  it("a same-day incident goes to the branch manager first, then the company manager when nobody looks", async () => {
    const id = await commitAs(users.teacherA, async (tx) => (await newIncident(tx, branchA, roomA, "injury", "moderate"))[0].id as string);
    const [alert] = await owner`select id, step from alert where subject_id = ${id} and key = 'incident'`;
    expect(alert.step).toBe(1);
    let who = await notified(alert.id);
    expect(who).toContain(users.branch_managerA);
    expect(who).not.toContain(users.company_managerA);
    await owner`update alert set next_step_at = now() - interval '1 minute' where id = ${alert.id}`;
    await job();
    who = await notified(alert.id);
    expect(who).toContain(users.company_managerA);
    expect(who).not.toContain(users.company_managerB);
  });

  it("looking at the incident stops the climb", async () => {
    const id = await commitAs(users.teacherA, async (tx) => (await newIncident(tx, branchA, roomA, "behaviour", "moderate"))[0].id as string);
    await commitAs(users.branch_managerA, (tx) => tx`select app_incident_seen(${id})`);
    await owner`update alert set next_step_at = now() - interval '1 minute' where subject_id = ${id}`;
    await job();
    const [a] = await owner`select id, resolved_at from alert where subject_id = ${id}`;
    expect(a.resolved_at).not.toBeNull();
    expect(await notified(a.id)).not.toContain(users.company_managerA);
  });

  it("the alert job cannot be run by a signed-in person", async () => {
    await as(users.ownerA, (tx) => expectError(tx, (sp) => sp`select app_run_alerts()`, denied));
    await as(users.ownerA, (tx) => expectError(tx, (sp) => sp`select * from app_claim_deliveries(10)`, denied));
  });
});

describe("alerts and phones are personal", () => {
  it("nobody reads another person's notifications or push subscriptions", async () => {
    await commitAs(users.teacherA, (tx) => tx`insert into push_subscription (user_id, endpoint, p256dh, auth) values (${users.teacherA}, ${`https://push.invalid/${run}`}, 'p256dh-key-xx', 'auth-key')`);
    await as(users.teacherA2, async (tx) => {
      expect(await tx`select 1 from push_subscription where user_id = ${users.teacherA}`).toHaveLength(0);
      await expectError(tx, (sp) => sp`insert into push_subscription (user_id, endpoint, p256dh, auth) values (${users.teacherA}, 'https://x.invalid', 'k', 'a')`, denied);
      expect(await tx`select 1 from notification where user_id = ${users.branch_managerA}`).toHaveLength(0);
    });
    await as(users.branch_managerB, async (tx) => {
      expect(await tx`select 1 from alert where branch_id = ${branchA}`).toHaveLength(0);
    });
  });
});

describe("issues (spec §8.8)", () => {
  it("a teacher reports; only a manager assigns; the person assigned moves it to done", async () => {
    const id = await commitAs(users.teacherA, async (tx) =>
      (await tx`insert into issue (branch_id, category, title, assigned_to, due_on) values (${branchA}, 'equipment', 'Fan broken', ${users.teacherA}, current_date) returning id, assigned_to`)[0],
    );
    expect(id.assigned_to).toBeNull();
    await as(users.teacherA, async (tx) => {
      expect(await tx`update issue set assigned_to = ${users.teacherA} where id = ${id.id} returning id`).toHaveLength(0);
    });
    await as(users.branch_managerA, (tx) =>
      expectError(tx, (sp) => sp`update issue set assigned_to = ${users.teacherB} where id = ${id.id}`, { message: "assignee_not_in_branch" }),
    );
    await commitAs(users.branch_managerA, (tx) => tx`update issue set assigned_to = ${users.teacherA2}, due_on = current_date + 2 where id = ${id.id}`);
    // The person assigned is told.
    const [alert] = await owner`select id from alert where subject_id = ${id.id} and key = 'issue_assigned'`;
    expect(await notified(alert.id)).toContain(users.teacherA2);
    // They may move it on but not change what it is.
    await as(users.teacherA2, (tx) => expectError(tx, (sp) => sp`update issue set title = 'other' where id = ${id.id}`, denied));
    await commitAs(users.teacherA2, (tx) => tx`update issue set status = 'resolved', resolution_note = 'Replaced' where id = ${id.id}`);
    const [row] = await owner`select status, resolved_by from issue where id = ${id.id}`;
    expect(row).toMatchObject({ status: "resolved", resolved_by: users.teacherA2 });
    // Every change is in the audit log.
    const audit = await owner`select count(*)::int as n from audit_event where table_name = 'issue' and row_id = ${id.id}`;
    expect(audit[0].n).toBeGreaterThanOrEqual(3);
  });
});
