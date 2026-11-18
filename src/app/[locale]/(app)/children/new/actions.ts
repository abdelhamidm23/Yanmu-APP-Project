"use server";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUserDb, dbErrorCode, dbRuleCode } from "@/db/rls";
import { activeCount, branchRooms, duplicateCandidates } from "@/db/children";
import { hasFile, saveUpload, UploadError, checkUpload } from "@/db/attachments";
import { approvalRequest, branch, consentRecord, enrollment, family, guardian, student, studentGuardian, studentMedical, waitlistEntry } from "@/db/schema";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/session";
import { canEditChildren, canEditMedical } from "@/lib/permissions";
import { CONSENT_PURPOSES, GENDERS, RELATIONSHIPS, ageAllowed, ageInMonths, findDuplicates, fitsBand, normalizePhone } from "@/lib/children";
import { todayInCairo } from "@/lib/calendar";

export type NewChildState =
  | { status: "idle" }
  | { status: "duplicate"; matches: { id: string; name: string; studentNo: string; reason: "nameAndBirth" | "phone" }[] }
  | { status: "overCapacity"; licensed: number }
  | { status: "error"; code: string; field?: string };

const name = z.string().trim().min(2).max(120);
const optional = z.string().trim().max(500).optional().transform((v) => v || null);
const isoDate = z.iso.date();

const schema = z.object({
  locale: z.enum(["ar", "en"]).catch("ar"),
  branchId: z.uuid(),
  waitlistId: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
  fullNameAr: name,
  fullNameEn: name,
  dateOfBirth: isoDate,
  gender: z.enum(GENDERS),
  familyMode: z.enum(["new", "existing"]),
  familyId: z.string().optional(),
  familyName: optional,
  roomId: z.uuid(),
  startDate: isoDate,
  bandReason: optional,
  capReason: optional,
  confirmDuplicate: z.string().optional(),
  allergies: optional,
  conditions: optional,
  medications: optional,
  doctorContact: optional,
});

const guardianSchema = z.object({
  fullName: name,
  relationship: z.enum(RELATIONSHIPS),
  phone: z.string().trim().min(1),
  idLast4: z.string().trim().regex(/^(\d{4})?$/),
  canPickUp: z.boolean(),
});

function readGuardian(fd: FormData, n: 1 | 2) {
  const raw = {
    fullName: String(fd.get(`g${n}Name`) ?? ""),
    relationship: String(fd.get(`g${n}Relationship`) ?? ""),
    phone: String(fd.get(`g${n}Phone`) ?? ""),
    idLast4: String(fd.get(`g${n}IdLast4`) ?? ""),
    canPickUp: fd.get(`g${n}PickUp`) === "on",
  };
  if (!raw.fullName.trim() && !raw.phone.trim()) return null;
  return { ...guardianSchema.parse(raw), photo: fd.get(`g${n}Photo`) };
}

/** Spec §8.1 "Add child": child → family → guardians → consent → room and start date. */
export async function createChild(_prev: NewChildState, fd: FormData): Promise<NewChildState> {
  const user = await getCurrentUser();
  if (!user || user.mustSetUpMfa) return { status: "error", code: "forbidden" };

  let input: z.infer<typeof schema>;
  let guardians: NonNullable<ReturnType<typeof readGuardian>>[];
  try {
    input = schema.parse(Object.fromEntries(fd.entries()));
    guardians = [readGuardian(fd, 1), readGuardian(fd, 2)].filter((g) => g !== null);
  } catch {
    return { status: "error", code: "invalid" };
  }
  if (!canEditChildren(user, input.branchId)) return { status: "error", code: "forbidden" };
  if (input.familyMode === "new" && guardians.length === 0) return { status: "error", code: "guardianRequired" };
  const phones: string[] = [];
  for (const [i, g] of guardians.entries()) {
    const p = normalizePhone(g.phone);
    if (!p) return { status: "error", code: "badPhone", field: `g${i + 1}Phone` };
    phones.push(p);
  }
  const scan = fd.get("consentScan");
  try {
    for (const f of [scan, ...guardians.map((g) => g.photo)]) if (hasFile(f)) checkUpload(f);
  } catch {
    return { status: "error", code: "badFile" };
  }
  const today = todayInCairo();
  if (!ageAllowed(ageInMonths(input.dateOfBirth, input.startDate)) && input.startDate >= today) {
    return { status: "error", code: "age_out_of_range" };
  }
  const consents = CONSENT_PURPOSES.filter((p) => fd.get(`consent_${p}`) === "on");

  let created: { id: string; pending: boolean };
  try {
    const result = await withUserDb(user.id, async (tx): Promise<NewChildState | { id: string; pending: boolean }> => {
      const rooms = await branchRooms(tx, input.branchId);
      const room = rooms.find((r) => r.id === input.roomId);
      if (!room) return { status: "error", code: "invalid" };
      if (!fitsBand(input.dateOfBirth, input.startDate > today ? input.startDate : today, room) && !input.bandReason) {
        return { status: "error", code: "band_reason_required" };
      }

      // Duplicate check (spec §8.1): same name + date of birth, or same parent phone.
      if (!input.confirmDuplicate) {
        const candidates = await duplicateCandidates(tx, input.branchId);
        const hits = findDuplicates({ fullNameAr: input.fullNameAr, fullNameEn: input.fullNameEn, dateOfBirth: input.dateOfBirth, phones }, candidates);
        // A brother or sister on the same family account shares the phone on purpose.
        const sameFamily = input.familyMode === "existing" ? new Set((await tx.select({ id: student.id }).from(student).where(eq(student.familyId, input.familyId ?? ""))).map((r) => r.id)) : new Set<string>();
        const relevant = hits.filter((h) => !(h.reason === "phone" && sameFamily.has(h.id)));
        if (relevant.length) {
          const byId = new Map(candidates.map((c) => [c.id, c]));
          return {
            status: "duplicate",
            matches: relevant.map((h) => {
              const c = byId.get(h.id)!;
              return { id: c.id, name: input.locale === "ar" ? c.fullNameAr : c.fullNameEn, studentNo: c.studentNo, reason: h.reason };
            }),
          };
        }
      }

      // Licence cap (spec D11): past the limit, the child waits for the owner.
      const [b] = await tx.select({ licensed: branch.licensedCapacity }).from(branch).where(eq(branch.id, input.branchId));
      const full = (await activeCount(tx, input.branchId)) >= b.licensed;
      if (full && !input.capReason) return { status: "overCapacity", licensed: b.licensed };

      let familyId: string;
      if (input.familyMode === "existing") {
        const [f] = await tx.select({ id: family.id }).from(family).where(and(eq(family.id, input.familyId ?? ""), eq(family.branchId, input.branchId)));
        if (!f) return { status: "error", code: "invalid" };
        familyId = f.id;
      } else {
        const [{ no }] = (await tx.execute(sql`select app_next_family_no(${input.branchId}) as no`)) as unknown as { no: string }[];
        const [f] = await tx
          .insert(family)
          .values({ branchId: input.branchId, accountNo: no, displayName: input.familyName ?? guardians[0].fullName })
          .returning({ id: family.id });
        familyId = f.id;
      }

      const guardianIds: { id: string; canPickUp: boolean }[] = [];
      for (const [i, g] of guardians.entries()) {
        const photoId = hasFile(g.photo) ? await saveUpload(tx, input.branchId, g.photo) : null;
        const [row] = await tx
          .insert(guardian)
          .values({ familyId, branchId: input.branchId, fullName: g.fullName, relationship: g.relationship, phone: phones[i], nationalIdLast4: g.idLast4 || null, photoAttachmentId: photoId })
          .returning({ id: guardian.id });
        guardianIds.push({ id: row.id, canPickUp: g.canPickUp });
      }
      if (input.familyMode === "existing") {
        // Parents already on the family account are linked to the new brother or sister.
        const existing = await tx.select({ id: guardian.id }).from(guardian).where(eq(guardian.familyId, familyId));
        for (const g of existing) if (!guardianIds.some((x) => x.id === g.id)) guardianIds.push({ id: g.id, canPickUp: true });
      }

      const [{ sno }] = (await tx.execute(sql`select app_next_student_no(${input.branchId}) as sno`)) as unknown as { sno: string }[];
      const [s] = await tx
        .insert(student)
        .values({ branchId: input.branchId, studentNo: sno, fullNameAr: input.fullNameAr, fullNameEn: input.fullNameEn, dateOfBirth: input.dateOfBirth, gender: input.gender, familyId, status: "pending" })
        .returning({ id: student.id });

      for (const [i, g] of guardianIds.entries()) {
        await tx.insert(studentGuardian).values({ studentId: s.id, guardianId: g.id, branchId: input.branchId, canPickUp: g.canPickUp, isPrimaryContact: i === 0 });
      }

      const scanId = hasFile(scan) ? await saveUpload(tx, input.branchId, scan) : null;
      for (const purpose of consents) {
        await tx.insert(consentRecord).values({
          studentId: s.id,
          branchId: input.branchId,
          guardianId: guardianIds[0]?.id ?? null,
          purpose,
          grantedOn: today,
          formAttachmentId: scanId,
          language: input.locale,
        });
      }

      const medical = [input.allergies, input.conditions, input.medications, input.doctorContact];
      if (medical.some(Boolean) && canEditMedical(user, input.branchId)) {
        await tx.insert(studentMedical).values({ studentId: s.id, branchId: input.branchId, allergies: input.allergies, conditions: input.conditions, medications: input.medications, doctorContact: input.doctorContact });
      }

      const [e] = await tx
        .insert(enrollment)
        .values({ studentId: s.id, branchId: input.branchId, roomId: room.id, startDate: input.startDate, status: full ? "pending_approval" : "active", bandOverrideReason: input.bandReason })
        .returning({ id: enrollment.id });
      if (full) {
        await tx.insert(approvalRequest).values({ branchId: input.branchId, type: "over_capacity", studentId: s.id, enrollmentId: e.id, reason: input.capReason });
      }

      if (input.waitlistId) {
        await tx.update(waitlistEntry).set({ status: "converted", convertedStudentId: s.id }).where(eq(waitlistEntry.id, input.waitlistId));
      }
      return { id: s.id, pending: full };
    });
    if ("status" in result) return result;
    created = result;
  } catch (e) {
    if (e instanceof UploadError) return { status: "error", code: "badFile" };
    const rule = dbRuleCode(e);
    if (rule) return { status: "error", code: rule };
    console.error("create child failed", dbErrorCode(e));
    return { status: "error", code: dbErrorCode(e) };
  }

  revalidatePath(`/${input.locale}/children`);
  redirect({ href: `/children/${created.id}?ok=${created.pending ? "pending" : "1"}`, locale: input.locale });
  return { status: "idle" };
}
