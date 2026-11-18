import "server-only";
import { and, asc, count, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { ageBand, approvalRequest, branch, consentRecord, enrollment, family, guardian, room, student, studentGuardian } from "./schema";
import type { Tx } from "./rls";

/** Branches the person can see (row-level security decides), in code order. */
export async function visibleBranches(tx: Tx) {
  return tx
    .select({ id: branch.id, nameAr: branch.nameAr, nameEn: branch.nameEn, code: branch.code, licensed: branch.licensedCapacity, physical: branch.physicalCapacity })
    .from(branch)
    .where(eq(branch.isActive, true))
    .orderBy(asc(branch.code));
}

export async function branchRooms(tx: Tx, branchId: string) {
  return tx
    .select({
      id: room.id,
      nameAr: room.nameAr,
      nameEn: room.nameEn,
      capacity: room.capacity,
      bandId: ageBand.id,
      bandNameAr: ageBand.nameAr,
      bandNameEn: ageBand.nameEn,
      minAgeMonths: ageBand.minAgeMonths,
      maxAgeMonths: ageBand.maxAgeMonths,
    })
    .from(room)
    .innerJoin(ageBand, eq(ageBand.id, room.ageBandId))
    .where(and(eq(room.branchId, branchId), eq(room.isActive, true)))
    .orderBy(asc(ageBand.sort), asc(room.nameEn));
}

/** Active enrollments in a branch (the licence counts these, spec §9.2). */
export async function activeCount(tx: Tx, branchId: string): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(enrollment).where(and(eq(enrollment.branchId, branchId), eq(enrollment.status, "active")));
  return r.n;
}

export type ChildFilter = { q?: string; roomId?: string; show?: "current" | "left" };

/** Children of a branch with their current room and flags. Teachers get only their rooms' children (RLS). */
export async function childList(tx: Tx, branchId: string, filter: ChildFilter = {}) {
  const current = filter.show !== "left";
  const open = sql`${enrollment.status} in ('active', 'pending_approval')`;
  const q = filter.q?.trim();
  const phoneDigits = q?.replace(/\D/g, "") ?? "";
  const rows = await tx
    .select({
      id: student.id,
      studentNo: student.studentNo,
      fullNameAr: student.fullNameAr,
      fullNameEn: student.fullNameEn,
      dateOfBirth: student.dateOfBirth,
      gender: student.gender,
      status: student.status,
      isDemo: student.isDemo,
      enrollmentStatus: enrollment.status,
      startDate: enrollment.startDate,
      bandOverride: enrollment.bandOverrideReason,
      roomId: room.id,
      roomNameAr: room.nameAr,
      roomNameEn: room.nameEn,
      bandMax: ageBand.maxAgeMonths,
      hasRecordsConsent: sql<boolean>`exists (select 1 from ${consentRecord} c where c.student_id = ${student.id} and c.purpose = 'records' and c.withdrawn_on is null)`,
    })
    .from(student)
    .leftJoin(enrollment, and(eq(enrollment.studentId, student.id), open))
    .leftJoin(room, eq(room.id, enrollment.roomId))
    .leftJoin(ageBand, eq(ageBand.id, room.ageBandId))
    .where(
      and(
        eq(student.branchId, branchId),
        current ? inArray(student.status, ["active", "pending"]) : inArray(student.status, ["withdrawn", "graduated"]),
        filter.roomId ? eq(enrollment.roomId, filter.roomId) : undefined,
        q
          ? or(
              ilike(student.fullNameAr, `%${q}%`),
              ilike(student.fullNameEn, `%${q}%`),
              ilike(student.studentNo, `%${q}%`),
              phoneDigits.length >= 4
                ? sql`exists (select 1 from ${studentGuardian} sg join ${guardian} g on g.id = sg.guardian_id
                              where sg.student_id = ${student.id} and g.phone like ${"%" + phoneDigits + "%"})`
                : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(asc(ageBand.sort), asc(room.nameEn), asc(student.fullNameEn))
    .limit(500);
  return rows;
}

/** Name, birth date and parent phones of every child in the branch, for the duplicate check. */
export async function duplicateCandidates(tx: Tx, branchId: string) {
  const rows = await tx
    .select({
      id: student.id,
      studentNo: student.studentNo,
      fullNameAr: student.fullNameAr,
      fullNameEn: student.fullNameEn,
      dateOfBirth: student.dateOfBirth,
      phones: sql<string[]>`coalesce((select array_agg(g.phone) from ${studentGuardian} sg join ${guardian} g on g.id = sg.guardian_id where sg.student_id = ${student.id}), '{}')`,
    })
    .from(student)
    .where(eq(student.branchId, branchId));
  return rows;
}

export async function branchFamilies(tx: Tx, branchId: string) {
  return tx
    .select({ id: family.id, accountNo: family.accountNo, displayName: family.displayName })
    .from(family)
    .where(eq(family.branchId, branchId))
    .orderBy(asc(family.displayName));
}

export async function pendingApprovalCount(tx: Tx, branchId: string): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(approvalRequest)
    .where(and(eq(approvalRequest.status, "pending"), or(eq(approvalRequest.branchId, branchId), eq(approvalRequest.toBranchId, branchId))));
  return r.n;
}

/** Every active branch's name (no other data), for transfers and request labels. */
export async function branchDirectory(tx: Tx) {
  const rows = (await tx.execute(sql`select id, name_ar as "nameAr", name_en as "nameEn", code from app_branch_directory()`)) as unknown as {
    id: string;
    nameAr: string;
    nameEn: string;
    code: string;
  }[];
  return [...rows];
}
