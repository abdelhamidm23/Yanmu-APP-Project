"use server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { withSafetyErrors } from "@/db/safety-errors";
import { hasFile, saveUpload, checkUpload } from "@/db/attachments";
import { incident, incidentAction, incidentFile, incidentPerson } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { requireUser } from "@/lib/require-user";
import { INCIDENT_CATEGORY_KEYS, INCIDENT_SEVERITY_KEYS, effectiveSeverity } from "@/lib/incidents";
import { sendSoon } from "@/lib/alert-job";
import { cairoWallToUtc } from "@/lib/calendar";

const locale = z.enum(["ar", "en"]).catch("ar");
const id = (fd: FormData, key = "incidentId") => z.uuid().parse(fd.get(key));

/** Runs one change on an incident and returns to its page with ?ok=1&done=… or ?error=…. */
async function onIncident(fd: FormData, done: string, work: (userId: string, incidentId: string) => Promise<void | { error: string }>) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const incidentId = id(fd);
  await runAndReturn(loc, `/incidents/${incidentId}`, async () => {
    const r = await withSafetyErrors(() => work(user.id, incidentId));
    if (r && "error" in r) return r;
    sendSoon();
    return { extra: { done } };
  });
}

const call = (userId: string, query: ReturnType<typeof sql>, reason?: string) =>
  withUserDb(userId, async (tx) => {
    await tx.execute(query);
  }, { reason });

export async function markSeen(fd: FormData) {
  await onIncident(fd, "seen", (u, i) => call(u, sql`select app_incident_seen(${i})`));
}

export async function submitReport(fd: FormData) {
  await onIncident(fd, "submitted", (u, i) => call(u, sql`select app_incident_submit_report(${i})`));
}

export async function reviewIncident(fd: FormData) {
  await onIncident(fd, "reviewed", (u, i) => {
    const note = z.string().trim().max(2000).parse(fd.get("note") ?? "");
    return call(u, sql`select app_incident_review(${i}, ${note})`, note || undefined);
  });
}

export async function closeIncident(fd: FormData) {
  await onIncident(fd, "closed", (u, i) => {
    const note = z.string().trim().max(2000).parse(fd.get("note") ?? "");
    return call(u, sql`select app_incident_close(${i}, ${note})`, note || undefined);
  });
}

/** First report corrections: class, kind, severity (never down from critical), what happened, what was done. */
export async function editIncident(fd: FormData) {
  await onIncident(fd, "saved", (u, i) => {
    const data = z
      .object({
        roomId: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
        category: z.enum(INCIDENT_CATEGORY_KEYS),
        severity: z.enum(INCIDENT_SEVERITY_KEYS),
        description: z.string().trim().min(3).max(4000),
        immediateAction: z.string().trim().max(4000),
      })
      .parse({
        roomId: fd.get("roomId") ?? "",
        category: fd.get("category"),
        severity: fd.get("severity"),
        description: fd.get("description") ?? "",
        immediateAction: fd.get("immediateAction") ?? "",
      });
    return withUserDb(u, async (tx) => {
      const r = await tx
        .update(incident)
        .set({ roomId: data.roomId, category: data.category, severity: effectiveSeverity(data.category, data.severity), description: data.description, immediateAction: data.immediateAction })
        .where(eq(incident.id, i))
        .returning({ id: incident.id });
      if (r.length === 0) return { error: "forbidden" };
    });
  });
}

/** Who told the guardian, when, and what was said (spec §8.7). The person saving is recorded as the one who told. */
export async function saveGuardian(fd: FormData) {
  await onIncident(fd, "saved", (u, i) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(fd.get("when") ?? ""));
    if (!m) return Promise.resolve({ error: "invalid" });
    // The phone sends Cairo wall-clock time (datetime-local); store it in UTC (rule 11).
    const at = cairoWallToUtc(+m[1], +m[2], +m[3], +m[4], +m[5]);
    const note = z.string().trim().min(2).max(2000).parse(fd.get("note"));
    if (Number.isNaN(at.getTime())) return Promise.resolve({ error: "invalid" });
    if (at.getTime() > Date.now() + 10 * 60_000) return Promise.resolve({ error: "invalid_date" });
    return withUserDb(u, async (tx) => {
      const r = await tx.update(incident).set({ guardianNotifiedAt: at, guardianNotificationNote: note }).where(eq(incident.id, i)).returning({ id: incident.id });
      if (r.length === 0) return { error: "forbidden" };
    });
  });
}

export async function saveReport(fd: FormData) {
  await onIncident(fd, "saved", (u, i) => {
    const details = z.string().trim().max(8000).parse(fd.get("reportDetails") ?? "");
    return withUserDb(u, async (tx) => {
      const r = await tx.update(incident).set({ reportDetails: details || null }).where(eq(incident.id, i)).returning({ id: incident.id });
      if (r.length === 0) return { error: "forbidden" };
    });
  });
}

export async function addPerson(fd: FormData) {
  await onIncident(fd, "personAdded", (u, i) => {
    const role = z.enum(["injured", "involved", "witness"]).parse(fd.get("role"));
    const who = z.string().parse(fd.get("who") ?? "");
    const name = z.string().trim().max(200).parse(fd.get("personName") ?? "");
    const [kind, ref] = who.split(":");
    const values =
      kind === "child" ? { studentId: z.uuid().parse(ref) } : kind === "staff" ? { staffId: z.uuid().parse(ref) } : name.length >= 2 ? { personName: name } : null;
    if (!values) return Promise.resolve({ error: "invalid" });
    return withUserDb(u, async (tx) => {
      const [inc] = await tx.select({ branchId: incident.branchId }).from(incident).where(eq(incident.id, i));
      if (!inc) return { error: "forbidden" };
      await tx.insert(incidentPerson).values({ incidentId: i, branchId: inc.branchId, role, ...values });
    });
  });
}

export async function removePerson(fd: FormData) {
  await onIncident(fd, "personRemoved", (u, i) => {
    const personId = id(fd, "personId");
    return withUserDb(u, async (tx) => {
      const r = await tx.delete(incidentPerson).where(and(eq(incidentPerson.id, personId), eq(incidentPerson.incidentId, i))).returning({ id: incidentPerson.id });
      if (r.length === 0) return { error: "forbidden" };
    });
  });
}

export async function addAction(fd: FormData) {
  await onIncident(fd, "actionAdded", (u, i) => {
    const data = z
      .object({ description: z.string().trim().min(3).max(1000), ownerUserId: z.uuid(), dueOn: z.iso.date() })
      .parse({ description: fd.get("description") ?? "", ownerUserId: fd.get("ownerUserId"), dueOn: fd.get("dueOn") });
    return withUserDb(u, async (tx) => {
      const [inc] = await tx.select({ branchId: incident.branchId }).from(incident).where(eq(incident.id, i));
      if (!inc) return { error: "forbidden" };
      await tx.insert(incidentAction).values({ incidentId: i, branchId: inc.branchId, ...data });
    });
  });
}

export async function actionDone(fd: FormData) {
  await onIncident(fd, "actionDone", (u) => call(u, sql`select app_incident_action_done(${id(fd, "actionId")})`));
}

export async function addFile(fd: FormData) {
  const file = fd.get("file");
  await onIncident(fd, "fileAdded", async (u, i) => {
    if (!hasFile(file)) return { error: "invalid" };
    try {
      checkUpload(file);
    } catch {
      return { error: "bad_file" };
    }
    return withUserDb(u, async (tx) => {
      const [inc] = await tx.select({ branchId: incident.branchId }).from(incident).where(eq(incident.id, i));
      if (!inc) return { error: "forbidden" };
      const att = await saveUpload(tx, inc.branchId, file);
      await tx.insert(incidentFile).values({ incidentId: i, branchId: inc.branchId, attachmentId: att });
    });
  });
}
