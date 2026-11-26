/**
 * Demo incidents and issues (spec §16), called by `pnpm seed:demo`. This month: Yanmu 2 incidents,
 * Norvale 4, one of them a critical incident still open at Norvale; last month a few closed ones; a
 * handful of maintenance issues, one overdue. Everything is made up and flagged is_demo.
 *
 * The rows go in through the same database rules as real ones (severity, alerts), then their history
 * is filled in (seen, reviewed, closed). Demo alerts are marked as already acknowledged and read, and
 * their SMS and push are skipped, so the demo never nags or texts anyone.
 * Runs once: if demo incidents already exist it does nothing.
 */
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { cairoWallToUtc, todayInCairo } from "../src/lib/calendar";

type Db = PostgresJsDatabase<typeof schema>;

type Stage = "open" | "seen" | "under_review" | "reviewed" | "closed";
type DemoIncident = {
  room: string | null;
  /** Days before today (kept inside the month for "this month" ones). */
  daysAgo: number;
  thisMonth: boolean;
  hour: number;
  category: (typeof schema.INCIDENT_CATEGORIES)[number];
  severity: (typeof schema.INCIDENT_SEVERITIES)[number];
  description: string;
  action: string;
  children: number;
  stage: Stage;
  report?: string;
};

const PLAN: Record<"A" | "B", DemoIncident[]> = {
  A: [
    { room: "Juniors 1", daysAgo: 9, thisMonth: true, hour: 10, category: "injury", severity: "minor", description: "Tripped on the mat during circle time and grazed a knee.", action: "Cleaned and covered the graze; child back to play.", children: 1, stage: "closed", report: "Mat edge had curled up. Mats now taped down every morning." },
    { room: "Toddlers 1", daysAgo: 2, thisMonth: true, hour: 12, category: "illness", severity: "moderate", description: "Temperature of 38.4 after lunch, sleepy.", action: "Kept apart in the quiet corner, temperature checked every 15 minutes, guardian called to collect.", children: 1, stage: "under_review", report: "Collected at 13:10. Class told to watch for the same signs; room aired." },
    { room: "Seniors 2", daysAgo: 40, thisMonth: false, hour: 11, category: "behaviour", severity: "minor", description: "Two children pushed each other while queuing for the slide.", action: "Separated and calmed down; talked about taking turns.", children: 2, stage: "closed", report: "Queue rule now shown with picture cards next to the slide." },
  ],
  B: [
    { room: "Toddlers 1", daysAgo: 1, thisMonth: true, hour: 10, category: "head_injury", severity: "critical", description: "Fell from the low climbing frame and hit the back of the head on the floor.", action: "First aid, child kept still and watched, guardian called, taken to the clinic by the guardian.", children: 1, stage: "seen" },
    { room: "Juniors 1", daysAgo: 6, thisMonth: true, hour: 9, category: "behaviour", severity: "minor", description: "Bit a classmate on the arm during free play.", action: "Checked the arm (no broken skin), cold compress, both guardians told at pickup.", children: 2, stage: "closed", report: "Teething phase. Teacher to shadow during free play for two weeks." },
    { room: "Seniors 1", daysAgo: 4, thisMonth: true, hour: 13, category: "injury", severity: "moderate", description: "Finger caught in the cupboard door.", action: "Cold compress; swelling went down; guardian told by phone.", children: 1, stage: "reviewed", report: "Soft-close hinges ordered for all low cupboards." },
    { room: null, daysAgo: 3, thisMonth: true, hour: 8, category: "hazard", severity: "minor", description: "Loose tile at the main entrance step.", action: "Area marked and blocked with a chair.", children: 0, stage: "seen" },
    { room: "Babies 1", daysAgo: 35, thisMonth: false, hour: 10, category: "allergic_reaction", severity: "critical", description: "Rash on the cheeks after a new fruit puree.", action: "Antihistamine as in the care plan, guardian came within 20 minutes.", children: 1, stage: "closed", report: "Puree came from home with a new ingredient. Food from home now checked against the allergy list at the door." },
    { room: "Juniors 2", daysAgo: 38, thisMonth: false, hour: 15, category: "injury", severity: "minor", description: "Bumped forehead on a table corner.", action: "Cold compress, watched for an hour, no further signs.", children: 1, stage: "closed", report: "Corner guards fitted to the two low tables." },
  ],
};

const ISSUES: Record<"A" | "B", { title: string; details: string; category: (typeof schema.ISSUE_CATEGORIES)[number]; priority: (typeof schema.ISSUE_PRIORITIES)[number]; dueIn: number | null; status: "open" | "in_progress" | "resolved"; note?: string }[]> = {
  A: [
    { title: "Air conditioner leaking in Seniors 1", details: "Water drips on the reading corner since Sunday.", category: "maintenance", priority: "high", dueIn: -2, status: "in_progress" },
    { title: "Class phone in Babies 1 will not charge", details: "Tried two cables.", category: "it", priority: "normal", dueIn: 3, status: "open" },
    { title: "Out of nappies size 4", details: "Two packs left.", category: "supplies", priority: "urgent", dueIn: -6, status: "resolved", note: "Delivered by the supplier." },
  ],
  B: [
    { title: "Loose tile at the entrance step", details: "Same as the hazard reported this week.", category: "safety", priority: "urgent", dueIn: 1, status: "in_progress" },
    { title: "Outdoor sand pit needs new sand", details: "", category: "equipment", priority: "low", dueIn: 10, status: "open" },
  ],
};

async function userId(db: Db, email: string): Promise<string | null> {
  const [u] = await db.select({ id: schema.appUser.id }).from(schema.appUser).where(eq(schema.appUser.email, email));
  return u?.id ?? null;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function seedDemoSafety(db: Db): Promise<string> {
  const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.incident).where(eq(schema.incident.isDemo, true));
  if (existing.n > 0) return `Demo incidents already there (${existing.n}).`;
  const today = todayInCairo();
  const monthFirst = `${today.slice(0, 7)}-01`;
  const people = {
    owner: await userId(db, "owner@yanmu.test"),
    cm: await userId(db, "company.manager@yanmu.test"),
    bm: { A: await userId(db, "branch.manager@yanmu.test"), B: await userId(db, "branch.manager.b@yanmu.test") },
    teacher: { A: await userId(db, "teacher@yanmu.test"), B: await userId(db, "multi.role@yanmu.test") },
    frontDesk: { A: await userId(db, "front.desk@yanmu.test"), B: await userId(db, "multi.role@yanmu.test") },
  };
  const branches = await db.select().from(schema.branch);
  let incidents = 0;
  let issues = 0;

  await db.transaction(async (tx) => {
    // As the system: the same triggers run, nobody is the "current user".
    await tx.execute(sql`select set_config('app.user_id', '', true)`);
    for (const code of ["A", "B"] as const) {
      const b = branches.find((x) => x.code === code);
      if (!b) continue;
      const rooms = await tx.select().from(schema.room).where(eq(schema.room.branchId, b.id));
      for (const p of PLAN[code]) {
        let day = addDays(today, -p.daysAgo);
        if (p.thisMonth && day < monthFirst) day = monthFirst;
        const [y, m, d] = day.split("-").map(Number);
        let at = cairoWallToUtc(y, m, d, p.hour, 20);
        if (at.getTime() > Date.now()) at = new Date(Date.now() - 30 * 60_000);
        const room = p.room ? rooms.find((r) => r.nameEn === p.room) : null;
        if (p.room && !room) continue;
        const reporter = p.room ? people.teacher[code] : people.frontDesk[code];
        const [inc] = await tx
          .insert(schema.incident)
          .values({
            branchId: b.id,
            roomId: room?.id ?? null,
            occurredAt: at,
            category: p.category,
            severity: p.severity,
            description: p.description,
            immediateAction: p.action,
            isDemo: true,
            createdBy: reporter,
            updatedBy: reporter,
          })
          .returning({ id: schema.incident.id });
        incidents++;
        // Children of that class (made-up demo children).
        if (room && p.children) {
          const kids = await tx.execute(sql`
            select s.id from student s join enrollment e on e.student_id = s.id and e.status = 'active'
            where s.is_demo and e.room_id = ${room.id} order by s.student_no limit ${p.children}`);
          for (const [i, k] of (kids as unknown as { id: string }[]).entries()) {
            await tx.insert(schema.incidentPerson).values({ incidentId: inc.id, branchId: b.id, studentId: k.id, role: i === 0 ? (p.category === "behaviour" ? "involved" : "injured") : "involved" });
          }
        }
        const min = (n: number) => new Date(at.getTime() + n * 60_000);
        const told = p.children ? { guardianNotifiedAt: min(25), guardianNotifiedBy: reporter, guardianNotificationNote: "Told by phone; guardian thanked the class team." } : {};
        const seen = { seenAt: min(12), seenBy: people.bm[code] };
        const submitted = { reportDetails: p.report ?? null, reportSubmittedAt: min(60 * 5), reportSubmittedBy: people.bm[code] };
        const reviewed = { reviewedAt: min(60 * 26), reviewedBy: people.cm, reviewNote: "Read and agreed with the actions." };
        const closer = p.severity === "critical" ? people.owner : people.cm;
        const closed = { closedAt: min(60 * 50), closedBy: closer, closeNote: "Actions done. Closed." };
        const fill =
          p.stage === "open" ? { ...told }
          : p.stage === "seen" ? { ...told, ...seen }
          : p.stage === "under_review" ? { ...told, ...seen, ...submitted, status: "under_review" }
          : p.stage === "reviewed" ? { ...told, ...seen, ...submitted, ...reviewed, status: "under_review" }
          : { ...told, ...seen, ...submitted, ...reviewed, ...closed, status: "closed" };
        await tx.update(schema.incident).set(fill).where(eq(schema.incident.id, inc.id));
        // One corrective action on reviewed incidents.
        if ((p.stage === "reviewed" || p.stage === "closed") && p.report && people.bm[code]) {
          const [act] = await tx
            .insert(schema.incidentAction)
            .values({
              incidentId: inc.id,
              branchId: b.id,
              description: p.report.split(". ").slice(-1)[0].replace(/\.$/, ""),
              ownerUserId: people.bm[code]!,
              dueOn: addDays(day, 7),
              isDemo: true,
            })
            .returning({ id: schema.incidentAction.id });
          if (p.stage === "closed") {
            await tx.update(schema.incidentAction).set({ doneAt: min(60 * 48), doneBy: people.bm[code] }).where(eq(schema.incidentAction.id, act.id));
          }
        }
        // The demo's alerts are history: dated with the incident, already acknowledged and read, never sent.
        await tx.execute(sql`
          update alert set raised_at = ${at.toISOString()}::timestamptz, last_sent_at = ${at.toISOString()}::timestamptz, next_step_at = null,
            acknowledged_at = case when tier = 'critical' then ${min(3).toISOString()}::timestamptz end,
            acknowledged_by = case when tier = 'critical' then ${people.bm[code]}::uuid end,
            resolved_at = case when ${p.stage !== "open"} and tier <> 'critical' then ${min(12).toISOString()}::timestamptz
                               when ${p.stage === "closed"} then ${min(60 * 50).toISOString()}::timestamptz end
          where subject_id = ${inc.id}`);
      }

      for (const it of ISSUES[code]) {
        const [row] = await tx
          .insert(schema.issue)
          .values({
            branchId: b.id,
            category: it.category,
            title: it.title,
            details: it.details || null,
            priority: it.priority,
            assignedTo: people.bm[code],
            dueOn: it.dueIn === null ? null : addDays(today, it.dueIn),
            isDemo: true,
            // Reported a few days before it was due, so "new issues today" stays honest.
            createdAt: new Date(Date.parse(`${addDays(today, Math.min(-3, (it.dueIn ?? 0) - 7))}T07:30:00Z`)),
            createdBy: people.teacher[code],
            updatedBy: people.teacher[code],
          })
          .returning({ id: schema.issue.id });
        if (it.status !== "open") {
          await tx.update(schema.issue).set({ status: it.status, resolutionNote: it.note ?? null }).where(eq(schema.issue.id, row.id));
        }
        issues++;
      }
    }
    // Nothing from the demo goes to a phone, and nothing stays unread.
    await tx.execute(sql`
      update notification_delivery d set status = 'skipped', detail = 'demo', sent_at = now()
      from notification n join alert a on a.id = n.alert_id
      where d.notification_id = n.id and a.is_demo and d.status = 'pending'`);
    await tx.execute(sql`update notification n set read_at = now() from alert a where a.id = n.alert_id and a.is_demo and n.read_at is null`);
  });
  return `Demo incidents ready: ${incidents} (this month Yanmu 2, Norvale 4; 1 critical open at Norvale) and ${issues} issues.`;
}
