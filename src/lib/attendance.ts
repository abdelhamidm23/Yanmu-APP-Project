/**
 * Child attendance, rosters and staff : children ratios (spec §7.4, §8.2, §8.3, §9.2, §9.3).
 * Pure functions, unit-tested in tests/unit/attendance.test.ts.
 */
import { z } from "zod";

export const ATTENDANCE_STATUSES = ["present", "absent", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * One tap on a class phone. Taps are queued on the phone while offline and sent later;
 * `clientUuid` makes a replay harmless and `at` (the moment of the tap) decides which tap wins.
 */
export const attendanceEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mark"),
    clientUuid: z.uuid(),
    at: z.iso.datetime(),
    studentId: z.uuid(),
    date: z.iso.date(),
    status: z.enum(ATTENDANCE_STATUSES),
    reason: z.string().trim().max(300).optional(),
  }),
  z.object({
    kind: z.literal("checkout"),
    clientUuid: z.uuid(),
    at: z.iso.datetime(),
    studentId: z.uuid(),
    date: z.iso.date(),
    guardianId: z.uuid(),
    /** "qr" when the adult's QR pickup card was scanned; otherwise picked from the approved list. */
    via: z.enum(["list", "qr"]).optional(),
  }),
  z.object({
    kind: z.literal("refusal"),
    clientUuid: z.uuid(),
    at: z.iso.datetime(),
    studentId: z.uuid(),
    date: z.iso.date(),
    personName: z.string().trim().max(120).optional(),
    note: z.string().trim().max(300).optional(),
  }),
]);
export type AttendanceEvent = z.infer<typeof attendanceEventSchema>;

/** What the server says about each tap it was sent. "rejected" taps are shown to the person, never silently dropped. */
export type EventResult =
  | { clientUuid: string; result: "applied" | "duplicate" | "stale" }
  | { clientUuid: string; result: "rejected"; code: string };

/** The current state of a child's day as the phone needs it. */
export interface DayRecord {
  status: AttendanceStatus | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  collectedByGuardianId: string | null;
  /** How the adult was checked at pickup. */
  checkOutVia?: "list" | "qr" | null;
  clientAt: string | null;
}

export const EMPTY_DAY: DayRecord = { status: null, checkInAt: null, checkOutAt: null, collectedByGuardianId: null, clientAt: null };

/**
 * Applies one tap to a child's day, the same way on the phone (before sending) and on the server.
 * A tap older than the last one applied is "stale" and changes nothing: two phones marking the
 * same child offline end with the later tap, whichever reaches the server first.
 */
export function applyEvent(day: DayRecord, ev: AttendanceEvent): { day: DayRecord; result: "applied" | "stale" } | { error: string } {
  if (ev.kind === "refusal") return { day, result: "applied" };
  if (day.clientAt && Date.parse(day.clientAt) > Date.parse(ev.at)) return { day, result: "stale" };
  if (ev.kind === "mark") {
    if (day.checkOutAt && ev.status !== "present") return { error: "already_checked_out" };
    return {
      day: {
        ...day,
        status: ev.status,
        // Spec §7.4: check-in time is when the child was first marked present.
        checkInAt: ev.status === "present" ? (day.checkInAt ?? ev.at) : null,
        clientAt: ev.at,
      },
      result: "applied",
    };
  }
  if (day.status !== "present") return { error: "not_checked_in" };
  if (day.checkOutAt) return { error: "already_checked_out" };
  return { day: { ...day, checkOutAt: ev.at, collectedByGuardianId: ev.guardianId, checkOutVia: ev.via ?? "list", clientAt: ev.at }, result: "applied" };
}

/** Spec §8.3: required_carers = ceil(children_present / children_per_staff). */
export function requiredCarers(childrenPresent: number, childrenPerStaff: number): number {
  if (childrenPresent <= 0) return 0;
  return Math.ceil(childrenPresent / Math.max(1, childrenPerStaff));
}

export type RatioState = "ok" | "breach" | "unconfirmed" | "empty";

/**
 * Ratio for one room. Carers count only once confirmed (fingerprint or the manager's tap);
 * when the confirmed ones are too few but unconfirmed ones on the roster would cover it,
 * the room is "unconfirmed" rather than a breach (rule 1: missing data is not zero).
 */
export function roomRatio(input: { childrenPresent: number; childrenPerStaff: number; carersConfirmed: number; carersUnconfirmed: number }) {
  const required = requiredCarers(input.childrenPresent, input.childrenPerStaff);
  let state: RatioState;
  if (input.childrenPresent === 0) state = "empty";
  else if (input.carersConfirmed >= required) state = "ok";
  else if (input.carersConfirmed + input.carersUnconfirmed >= required) state = "unconfirmed";
  else state = "breach";
  return { required, state, isBreach: state === "breach" };
}

/** Whether a rostered person counts as present: the manager's tap wins, then the fingerprint day. */
export function carerPresence(markedPresent: boolean | null, dayStatus: string | null): "yes" | "no" | "unknown" {
  if (markedPresent === true) return "yes";
  if (markedPresent === false) return "no";
  if (dayStatus === "present" || dayStatus === "late") return "yes";
  if (dayStatus === "absent" || dayStatus === "leave") return "no";
  return "unknown";
}

/** Today's room for each person: a roster row for the day wins, otherwise their usual room. */
export function effectiveRoster<S extends { id: string; defaultRoomId: string | null }>(
  staff: S[],
  rosterRows: { staffId: string; roomId: string | null; markedPresent: boolean | null }[],
) {
  const rows = new Map(rosterRows.map((r) => [r.staffId, r]));
  return staff.map((s) => {
    const r = rows.get(s.id);
    return { ...s, roomId: r ? r.roomId : s.defaultRoomId, markedPresent: r?.markedPresent ?? null, moved: Boolean(r) && r!.roomId !== s.defaultRoomId };
  });
}

/** Spec §9.2 "Attendance today": present ÷ expected (active children not excused). */
export function attendanceSummary(statuses: (AttendanceStatus | null)[]) {
  const present = statuses.filter((s) => s === "present").length;
  const absent = statuses.filter((s) => s === "absent").length;
  const excused = statuses.filter((s) => s === "excused").length;
  const notMarked = statuses.filter((s) => s === null).length;
  return { present, absent, excused, notMarked, expected: statuses.length - excused, complete: notMarked === 0 && statuses.length > 0 };
}

/**
 * Spec §8.2, as set by the owner: the school day ends at `attendance.closing_time` (16:00) and an
 * after-school hour (`attendance.after_school_minutes`, 60) covers late pickups. Children still
 * checked in after that alert the branch manager. Returns "HH:MM", capped at 23:59.
 */
export function stillInAlertTime(closing: string, afterSchoolMinutes: number): string {
  const [h, m] = closing.split(":").map(Number);
  const total = Math.min(h * 60 + m + Math.max(0, afterSchoolMinutes), 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
