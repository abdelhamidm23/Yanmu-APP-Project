import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { enrollment, guardian, room, student, studentAttendance, studentGuardian } from "./schema";
import { db } from "./index";
import type { Tx } from "./rls";
import { addDays } from "@/lib/children";
import { matchPickupCode } from "@/lib/pickup-code";

/**
 * The child a daily pickup code belongs to, among the children enrolled in this branch now.
 * Row-level security limits the search to children the scanning person may see.
 * "old" means it is the child's code from yesterday, or a code replaced with a new one today.
 */
export async function findChildByCode(tx: Tx, branchId: string, code: string, today: string) {
  const kids = await tx
    .select({
      id: student.id,
      pickupCodeVersion: student.pickupCodeVersion,
      fullNameAr: student.fullNameAr,
      fullNameEn: student.fullNameEn,
      photoId: student.photoAttachmentId,
      classNameAr: room.nameAr,
      classNameEn: room.nameEn,
    })
    .from(enrollment)
    .innerJoin(student, eq(student.id, enrollment.studentId))
    .innerJoin(room, eq(room.id, enrollment.roomId))
    .where(and(eq(enrollment.status, "active"), eq(student.branchId, branchId)));
  return matchPickupCode(code, kids, today, addDays(today, -1));
}

/** Today's attendance for one child and the adults who may collect them. */
export async function pickupDetails(tx: Tx, studentId: string, date: string) {
  const [day] = await tx
    .select({ status: studentAttendance.status, checkOutAt: studentAttendance.checkOutAt, collectedBy: studentAttendance.collectedByGuardianId })
    .from(studentAttendance)
    .where(and(eq(studentAttendance.studentId, studentId), eq(studentAttendance.date, date)));
  const adults = await tx
    .select({ id: guardian.id, fullName: guardian.fullName, relationship: guardian.relationship, photoId: guardian.photoAttachmentId })
    .from(studentGuardian)
    .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
    .where(and(eq(studentGuardian.studentId, studentId), eq(studentGuardian.canPickUp, true)))
    .orderBy(desc(studentGuardian.isPrimaryContact), asc(guardian.fullName));
  const state: "in" | "not_in" | "gone" = day?.checkOutAt ? "gone" : day?.status === "present" ? "in" : "not_in";
  return {
    state,
    checkOutAt: day?.checkOutAt?.toISOString() ?? null,
    collectedBy: adults.find((a) => a.id === day?.collectedBy)?.fullName ?? null,
    adults,
  };
}

export interface LinkChild {
  guardian_name: string;
  student_id: string;
  full_name_ar: string;
  full_name_en: string;
  pickup_code_version: number;
  branch_name_ar: string;
  branch_name_en: string;
}

/**
 * The children an adult may collect, for their private pickup link page. The person opening the
 * link is not signed in, so this goes through one database function that answers only for the
 * link's own adult, and only while the link is in use.
 */
export async function linkChildren(linkHash: string): Promise<LinkChild[]> {
  const rows = await db.execute(sql`select * from app_pickup_link_children(${linkHash})`);
  return rows as unknown as LinkChild[];
}
