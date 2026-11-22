import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  ageBand,
  branch,
  enrollment,
  guardian,
  importBatch,
  pickupRefusal,
  ratioSnapshot,
  room,
  roomRoster,
  staff,
  staffAttendanceDay,
  student,
  studentAttendance,
  studentGuardian,
  studentMedical,
  userRoom,
} from "./schema";
import type { Tx } from "./rls";
import type { CurrentUser } from "@/lib/session";
import { ATTENDANCE_EDIT_ROLES, hasRoleIn } from "@/lib/permissions";
import { attendanceSummary, carerPresence, effectiveRoster, roomRatio, type AttendanceStatus } from "@/lib/attendance";

/** Rooms this person takes roll call for: every room of their branches (manager, front desk) or their assigned rooms (teacher). */
export async function attendanceRooms(tx: Tx, user: Pick<CurrentUser, "id" | "grants">) {
  const rows = await tx
    .select({
      id: room.id,
      nameAr: room.nameAr,
      nameEn: room.nameEn,
      branchId: room.branchId,
      branchNameAr: branch.nameAr,
      branchNameEn: branch.nameEn,
      branchCode: branch.code,
      bandSort: ageBand.sort,
      assigned: sql<boolean>`exists (select 1 from ${userRoom} ur where ur.room_id = ${room.id} and ur.user_id = ${user.id})`,
    })
    .from(room)
    .innerJoin(branch, eq(branch.id, room.branchId))
    .innerJoin(ageBand, eq(ageBand.id, room.ageBandId))
    .where(and(eq(room.isActive, true), eq(branch.isActive, true)))
    .orderBy(asc(branch.code), asc(ageBand.sort), asc(room.nameEn));
  const teacherBranches = new Set(user.grants.filter((g) => g.role === "teacher").map((g) => g.branchId));
  return rows.filter(
    (r) => hasRoleIn(user, ATTENDANCE_EDIT_ROLES, r.branchId) || (r.assigned && (teacherBranches.has(r.branchId) || teacherBranches.has(null))),
  );
}

export type RoomChild = NonNullable<Awaited<ReturnType<typeof roomDay>>>["children"][number];

/**
 * Everything a class phone needs for one room and day: the children, who may collect each one,
 * today's marks, and (for teachers and the branch manager) whether there are allergy notes.
 */
export async function roomDay(tx: Tx, roomId: string, date: string, opts: { medical: boolean }) {
  const [r] = await tx
    .select({ id: room.id, nameAr: room.nameAr, nameEn: room.nameEn, branchId: room.branchId, perStaff: ageBand.childrenPerStaff })
    .from(room)
    .innerJoin(ageBand, eq(ageBand.id, room.ageBandId))
    .where(eq(room.id, roomId));
  if (!r) return null;

  const kids = await tx
    .select({
      id: student.id,
      studentNo: student.studentNo,
      fullNameAr: student.fullNameAr,
      fullNameEn: student.fullNameEn,
      photoId: student.photoAttachmentId,
      status: studentAttendance.status,
      checkInAt: studentAttendance.checkInAt,
      checkOutAt: studentAttendance.checkOutAt,
      collectedBy: studentAttendance.collectedByGuardianId,
      clientAt: studentAttendance.clientAt,
    })
    .from(enrollment)
    .innerJoin(student, eq(student.id, enrollment.studentId))
    .leftJoin(studentAttendance, and(eq(studentAttendance.studentId, student.id), eq(studentAttendance.date, date)))
    .where(and(eq(enrollment.roomId, roomId), eq(enrollment.status, "active")))
    .orderBy(asc(student.fullNameEn));

  const ids = kids.map((k) => k.id);
  const adults = ids.length
    ? await tx
        .select({
          studentId: studentGuardian.studentId,
          id: guardian.id,
          fullName: guardian.fullName,
          relationship: guardian.relationship,
          photoId: guardian.photoAttachmentId,
          canPickUp: studentGuardian.canPickUp,
        })
        .from(studentGuardian)
        .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
        .where(inArray(studentGuardian.studentId, ids))
        .orderBy(desc(studentGuardian.isPrimaryContact), asc(guardian.fullName))
    : [];
  const medical =
    opts.medical && ids.length
      ? await tx
          .select({ studentId: studentMedical.studentId, allergies: studentMedical.allergies, conditions: studentMedical.conditions, medications: studentMedical.medications })
          .from(studentMedical)
          .where(inArray(studentMedical.studentId, ids))
      : [];
  const medicalBy = new Map(medical.map((m) => [m.studentId, m]));

  return {
    room: r,
    children: kids.map((k) => {
      const m = medicalBy.get(k.id);
      return {
        id: k.id,
        studentNo: k.studentNo,
        fullNameAr: k.fullNameAr,
        fullNameEn: k.fullNameEn,
        photoId: k.photoId,
        day: {
          status: (k.status as AttendanceStatus | null) ?? null,
          checkInAt: k.checkInAt?.toISOString() ?? null,
          checkOutAt: k.checkOutAt?.toISOString() ?? null,
          collectedByGuardianId: k.collectedBy,
          clientAt: k.clientAt?.toISOString() ?? null,
        },
        pickup: adults.filter((a) => a.studentId === k.id && a.canPickUp).map(({ id, fullName, relationship, photoId }) => ({ id, fullName, relationship, photoId })),
        medical: m && (m.allergies || m.conditions || m.medications) ? { allergies: m.allergies, conditions: m.conditions, medications: m.medications } : null,
      };
    }),
  };
}

/** Staff of a branch with today's room (roster row, else usual room) and presence. */
export async function branchRosterToday(tx: Tx, branchId: string, date: string) {
  const people = await tx
    .select({
      id: staff.id,
      fullNameAr: staff.fullNameAr,
      fullNameEn: staff.fullNameEn,
      jobTitle: staff.jobTitle,
      isQualifiedCarer: staff.isQualifiedCarer,
      defaultRoomId: staff.defaultRoomId,
      dayStatus: staffAttendanceDay.status,
      firstIn: staffAttendanceDay.firstIn,
    })
    .from(staff)
    .leftJoin(staffAttendanceDay, and(eq(staffAttendanceDay.staffId, staff.id), eq(staffAttendanceDay.date, date)))
    .where(and(eq(staff.branchId, branchId), eq(staff.status, "active")))
    .orderBy(asc(staff.fullNameEn));
  const rows = await tx
    .select({ staffId: roomRoster.staffId, roomId: roomRoster.roomId, markedPresent: roomRoster.markedPresent })
    .from(roomRoster)
    .where(and(eq(roomRoster.branchId, branchId), eq(roomRoster.date, date)));
  return effectiveRoster(people, rows).map((p) => ({ ...p, presence: carerPresence(p.markedPresent, p.dayStatus) }));
}

/** Spec §11.6 "Attendance by room" and "ratio status per room" for a branch today. */
export async function branchRoomsToday(tx: Tx, branchId: string, date: string, opts: { roster: boolean }) {
  const rooms = await tx
    .select({ id: room.id, nameAr: room.nameAr, nameEn: room.nameEn, perStaff: ageBand.childrenPerStaff, bandSort: ageBand.sort })
    .from(room)
    .innerJoin(ageBand, eq(ageBand.id, room.ageBandId))
    .where(and(eq(room.branchId, branchId), eq(room.isActive, true)))
    .orderBy(asc(ageBand.sort), asc(room.nameEn));
  const marks = await tx
    .select({ roomId: enrollment.roomId, status: studentAttendance.status, out: studentAttendance.checkOutAt })
    .from(enrollment)
    .leftJoin(studentAttendance, and(eq(studentAttendance.studentId, enrollment.studentId), eq(studentAttendance.date, date)))
    .where(and(eq(enrollment.branchId, branchId), eq(enrollment.status, "active")));
  const roster = opts.roster ? await branchRosterToday(tx, branchId, date) : [];

  return rooms.map((r) => {
    const mine = marks.filter((m) => m.roomId === r.id);
    const summary = attendanceSummary(mine.map((m) => (m.status as AttendanceStatus | null) ?? null));
    const inNow = mine.filter((m) => m.status === "present" && !m.out).length;
    const carers = roster.filter((p) => p.roomId === r.id && p.isQualifiedCarer);
    const confirmed = carers.filter((p) => p.presence === "yes").length;
    const unconfirmed = carers.filter((p) => p.presence === "unknown").length;
    return {
      ...r,
      enrolled: mine.length,
      ...summary,
      inNow,
      carersConfirmed: confirmed,
      carersUnconfirmed: unconfirmed,
      ratio: roomRatio({ childrenPresent: inNow, childrenPerStaff: r.perStaff, carersConfirmed: confirmed, carersUnconfirmed: unconfirmed }),
    };
  });
}

/** Spec §8.2: refused pickups today that the branch manager has not looked at. */
export async function openRefusals(tx: Tx, branchId: string, since: Date) {
  return tx
    .select({
      id: pickupRefusal.id,
      studentId: pickupRefusal.studentId,
      fullNameAr: student.fullNameAr,
      fullNameEn: student.fullNameEn,
      personName: pickupRefusal.personName,
      note: pickupRefusal.note,
      happenedAt: pickupRefusal.happenedAt,
      acknowledgedAt: pickupRefusal.acknowledgedAt,
    })
    .from(pickupRefusal)
    .innerJoin(student, eq(student.id, pickupRefusal.studentId))
    .where(and(eq(pickupRefusal.branchId, branchId), gte(pickupRefusal.happenedAt, since)))
    .orderBy(desc(pickupRefusal.happenedAt));
}

/** Spec §16 "ratio breaches today": rooms whose recorded ratio fell short at any time since `since`. */
export async function roomsBreachedSince(tx: Tx, branchId: string, since: Date): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ roomId: ratioSnapshot.roomId })
    .from(ratioSnapshot)
    .where(and(eq(ratioSnapshot.branchId, branchId), eq(ratioSnapshot.isBreach, true), gte(ratioSnapshot.takenAt, since)));
  return rows.map((r) => r.roomId);
}

/** Children marked present today and not yet collected. */
export async function stillCheckedIn(tx: Tx, branchId: string, date: string) {
  return tx
    .select({ id: student.id, fullNameAr: student.fullNameAr, fullNameEn: student.fullNameEn, roomNameAr: room.nameAr, roomNameEn: room.nameEn })
    .from(studentAttendance)
    .innerJoin(student, eq(student.id, studentAttendance.studentId))
    .innerJoin(room, eq(room.id, studentAttendance.roomId))
    .where(and(eq(studentAttendance.branchId, branchId), eq(studentAttendance.date, date), eq(studentAttendance.status, "present"), isNull(studentAttendance.checkOutAt)))
    .orderBy(asc(room.nameEn), asc(student.fullNameEn));
}

/** The latest fingerprint file of a branch (spec §11.6 "staff upload status"). */
export async function lastPunchImport(tx: Tx, branchId: string) {
  const [b] = await tx
    .select({ id: importBatch.id, createdAt: importBatch.createdAt, rowCount: importBatch.rowCount, status: importBatch.status })
    .from(importBatch)
    .where(and(eq(importBatch.branchId, branchId), eq(importBatch.kind, "staff_punches"), eq(importBatch.status, "committed")))
    .orderBy(desc(importBatch.createdAt))
    .limit(1);
  return b ?? null;
}
