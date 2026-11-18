"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb, dbErrorCode, dbRuleCode, type Tx } from "@/db/rls";
import { hasFile, saveUpload } from "@/db/attachments";
import { approvalRequest, consentRecord, enrollment, guardian, student, studentGuardian, studentMedical } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { getCurrentUser } from "@/lib/session";
import { canBreakGlass, canEditChildren, canEditMedical } from "@/lib/permissions";
import { CONSENT_PURPOSES, GENDERS, RELATIONSHIPS, WITHDRAW_REASONS, normalizePhone } from "@/lib/children";
import { todayInCairo } from "@/lib/calendar";
import { requireUser } from "@/lib/require-user";

const locale = z.enum(["ar", "en"]).catch("ar");
const optional = z.string().trim().max(500).transform((v) => v || null);
const isoDate = z.iso.date();

/** Loads the child's branch (through RLS) and checks the person may edit children there. */
async function editable(tx: Tx, userGrants: Parameters<typeof canEditChildren>[0], studentId: string) {
  const [s] = await tx.select({ branchId: student.branchId }).from(student).where(eq(student.id, studentId));
  if (!s || !canEditChildren(userGrants, s.branchId)) return null;
  return s.branchId;
}

/** Shared wrapper: parse ids, run the change as the person, return to the child page with ?ok or ?error. */
async function childAction(fd: FormData, work: (ctx: { tx: Tx; branchId: string; studentId: string; user: Awaited<ReturnType<typeof requireUser>> }) => Promise<void | { error: string }>) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const studentId = z.uuid().parse(fd.get("studentId"));
  await runAndReturn(loc, `/children/${studentId}`, async () => {
    try {
      return await withUserDb(user.id, async (tx) => {
        const branchId = await editable(tx, user, studentId);
        if (!branchId) return { error: "forbidden" };
        return work({ tx, branchId, studentId, user });
      });
    } catch (e) {
      const rule = dbRuleCode(e);
      if (rule) return { error: rule };
      throw e;
    }
  });
}

export async function updateChild(fd: FormData) {
  await childAction(fd, async ({ tx, studentId }) => {
    const data = z
      .object({ fullNameAr: z.string().trim().min(2).max(120), fullNameEn: z.string().trim().min(2).max(120), dateOfBirth: isoDate, gender: z.enum(GENDERS) })
      .parse(Object.fromEntries(fd.entries()));
    await tx.update(student).set(data).where(eq(student.id, studentId));
  });
}

export async function addGuardian(fd: FormData) {
  await childAction(fd, async ({ tx, branchId, studentId }) => {
    const data = z
      .object({ fullName: z.string().trim().min(2).max(120), relationship: z.enum(RELATIONSHIPS), phone: z.string(), idLast4: z.string().trim().regex(/^(\d{4})?$/) })
      .parse(Object.fromEntries(fd.entries()));
    const phone = normalizePhone(data.phone);
    if (!phone) return { error: "badPhone" };
    const [s] = await tx.select({ familyId: student.familyId }).from(student).where(eq(student.id, studentId));
    const photo = fd.get("photo");
    const photoId = hasFile(photo) ? await saveUpload(tx, branchId, photo) : null;
    const [g] = await tx
      .insert(guardian)
      .values({ familyId: s.familyId, branchId, fullName: data.fullName, relationship: data.relationship, phone, nationalIdLast4: data.idLast4 || null, photoAttachmentId: photoId })
      .returning({ id: guardian.id });
    await tx.insert(studentGuardian).values({ studentId, guardianId: g.id, branchId, canPickUp: fd.get("canPickUp") === "on" });
  });
}

/** Who may collect the child (spec §8.2 builds the check-out on this). */
export async function setPickUp(fd: FormData) {
  await childAction(fd, async ({ tx, studentId }) => {
    const guardianId = z.uuid().parse(fd.get("guardianId"));
    await tx
      .update(studentGuardian)
      .set({ canPickUp: fd.get("canPickUp") === "true" })
      .where(and(eq(studentGuardian.studentId, studentId), eq(studentGuardian.guardianId, guardianId)));
  });
}

export async function saveMedical(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const studentId = z.uuid().parse(fd.get("studentId"));
  await runAndReturn(loc, `/children/${studentId}`, async () => {
    const data = z
      .object({ allergies: optional, conditions: optional, medications: optional, doctorContact: optional })
      .parse(Object.fromEntries(fd.entries()));
    return withUserDb(user.id, async (tx) => {
      const [s] = await tx.select({ branchId: student.branchId }).from(student).where(eq(student.id, studentId));
      if (!s || !canEditMedical(user, s.branchId)) return { error: "forbidden" };
      await tx
        .insert(studentMedical)
        .values({ studentId, branchId: s.branchId, ...data })
        .onConflictDoUpdate({ target: studentMedical.studentId, set: data });
    });
  });
}

export type BreakGlassState = { status: "idle" } | { status: "error"; code: string } | { status: "ok"; medical: { allergies: string | null; conditions: string | null; medications: string | null; doctorContact: string | null } | null };

/** Owner / company manager opens medical notes after giving a reason; the database logs it (spec §5). */
export async function breakGlass(_prev: BreakGlassState, fd: FormData): Promise<BreakGlassState> {
  const user = await getCurrentUser();
  if (!user || user.mustSetUpMfa) return { status: "error", code: "forbidden" };
  const studentId = z.uuid().safeParse(fd.get("studentId"));
  const reason = String(fd.get("reason") ?? "").trim();
  if (!studentId.success) return { status: "error", code: "invalid" };
  if (reason.length < 5) return { status: "error", code: "reason_required" };
  try {
    return await withUserDb(user.id, async (tx) => {
      const [s] = await tx.select({ branchId: student.branchId }).from(student).where(eq(student.id, studentId.data));
      if (!s || !canBreakGlass(user, s.branchId)) return { status: "error", code: "forbidden" } as const;
      const rows = (await tx.execute(
        sql`select allergies, conditions, medications, doctor_contact as "doctorContact" from app_break_glass_medical(${studentId.data}, ${reason})`,
      )) as unknown as { allergies: string | null; conditions: string | null; medications: string | null; doctorContact: string | null }[];
      return { status: "ok", medical: rows[0] ? { ...rows[0] } : null } as const;
    });
  } catch (e) {
    return { status: "error", code: dbRuleCode(e) ?? dbErrorCode(e) };
  }
}

export async function addConsent(fd: FormData) {
  await childAction(fd, async ({ tx, branchId, studentId }) => {
    const data = z.object({ purpose: z.enum(CONSENT_PURPOSES), grantedOn: isoDate, guardianId: z.union([z.uuid(), z.literal("")]) }).parse(Object.fromEntries(fd.entries()));
    const scan = fd.get("scan");
    const formAttachmentId = hasFile(scan) ? await saveUpload(tx, branchId, scan) : null;
    await tx.insert(consentRecord).values({
      studentId,
      branchId,
      guardianId: data.guardianId || null,
      purpose: data.purpose,
      grantedOn: data.grantedOn,
      formAttachmentId,
      language: locale.parse(fd.get("locale")),
    });
  });
}

export async function withdrawConsent(fd: FormData) {
  await childAction(fd, async ({ tx, studentId }) => {
    const id = z.uuid().parse(fd.get("consentId"));
    await tx
      .update(consentRecord)
      .set({ withdrawnOn: todayInCairo() })
      .where(and(eq(consentRecord.id, id), eq(consentRecord.studentId, studentId)));
  });
}

export async function moveRoom(fd: FormData) {
  await childAction(fd, async ({ tx, studentId }) => {
    const data = z.object({ roomId: z.uuid(), bandReason: optional }).parse(Object.fromEntries(fd.entries()));
    const rows = await tx
      .update(enrollment)
      .set({ roomId: data.roomId, bandOverrideReason: data.bandReason })
      .where(and(eq(enrollment.studentId, studentId), inArray(enrollment.status, ["active", "pending_approval"])))
      .returning({ id: enrollment.id });
    if (rows.length === 0) return { error: "notFound" };
  });
}

/** The sending branch asks; the receiving branch manager accepts on the approvals screen (spec §8.1). */
export async function requestTransfer(fd: FormData) {
  await childAction(fd, async ({ tx, branchId, studentId }) => {
    const data = z.object({ toBranchId: z.uuid(), reason: z.string().trim().min(3).max(500) }).parse(Object.fromEntries(fd.entries()));
    if (data.toBranchId === branchId) return { error: "invalid" };
    const open = await tx
      .select({ id: approvalRequest.id })
      .from(approvalRequest)
      .where(and(eq(approvalRequest.studentId, studentId), eq(approvalRequest.type, "transfer"), eq(approvalRequest.status, "pending")));
    if (open.length) return { error: "duplicate" };
    await tx.insert(approvalRequest).values({ branchId, type: "transfer", studentId, toBranchId: data.toBranchId, reason: data.reason });
  });
}

/** Withdrawal (spec §8.1): reason and last day. Refunds of unused days come with the money screens (Phase 4). */
export async function withdrawChild(fd: FormData) {
  await childAction(fd, async ({ tx, studentId }) => {
    const data = z
      .object({ lastDay: isoDate, reason: z.enum([...WITHDRAW_REASONS, "graduated"]), note: optional })
      .parse(Object.fromEntries(fd.entries()));
    const graduated = data.reason === "graduated";
    const rows = await tx
      .update(enrollment)
      .set({ status: graduated ? "graduated" : "withdrawn", endDate: data.lastDay, endReason: data.note ? `${data.reason}: ${data.note}` : data.reason })
      .where(and(eq(enrollment.studentId, studentId), eq(enrollment.status, "active")))
      .returning({ id: enrollment.id });
    if (rows.length === 0) return { error: "notFound" };
    // A pending transfer or over-capacity request for a child who left is no longer needed.
    await tx
      .update(approvalRequest)
      .set({ status: "cancelled" })
      .where(and(eq(approvalRequest.studentId, studentId), eq(approvalRequest.status, "pending")));
  });
}
