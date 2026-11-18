import { describe, expect, it } from "vitest";
import {
  EMPTY_DAY,
  applyEvent,
  attendanceEventSchema,
  attendanceSummary,
  carerPresence,
  effectiveRoster,
  requiredCarers,
  roomRatio,
  type AttendanceEvent,
  type DayRecord,
} from "@/lib/attendance";
import { cairoOffsetMinutes, cairoTimeOf, cairoWallToUtc, minutesOf } from "@/lib/calendar";

const kid = "8a0b8f9e-1d8c-4a3b-9a55-0d6c1b7c2f11";
const mum = "2f6c7d1e-3a4b-4c5d-8e9f-0a1b2c3d4e5f";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mark = (n: number, at: string, status: "present" | "absent" | "excused"): AttendanceEvent => ({
  kind: "mark",
  clientUuid: uuid(n),
  at,
  studentId: kid,
  date: "2026-11-18",
  status,
});
const checkout = (n: number, at: string): AttendanceEvent => ({ kind: "checkout", clientUuid: uuid(n), at, studentId: kid, date: "2026-11-18", guardianId: mum });

function play(events: AttendanceEvent[], start: DayRecord = EMPTY_DAY) {
  let day = start;
  const results: string[] = [];
  for (const ev of events) {
    const r = applyEvent(day, ev);
    if ("error" in r) results.push(r.error);
    else {
      day = r.day;
      results.push(r.result);
    }
  }
  return { day, results };
}

describe("roll call taps (spec §8.2)", () => {
  it("accepts only well-formed taps", () => {
    expect(attendanceEventSchema.safeParse(mark(1, "2026-11-18T06:05:00.000Z", "present")).success).toBe(true);
    expect(attendanceEventSchema.safeParse({ ...mark(1, "2026-11-18T06:05:00.000Z", "present"), status: "late" }).success).toBe(false);
    expect(attendanceEventSchema.safeParse({ ...checkout(2, "2026-11-18T13:00:00.000Z"), guardianId: "someone" }).success).toBe(false);
  });

  it("keeps the first check-in time when a child is marked present again", () => {
    const { day } = play([mark(1, "2026-11-18T06:05:00.000Z", "present"), mark(2, "2026-11-18T06:20:00.000Z", "present")]);
    expect(day.status).toBe("present");
    expect(day.checkInAt).toBe("2026-11-18T06:05:00.000Z");
    expect(day.clientAt).toBe("2026-11-18T06:20:00.000Z");
  });

  it("clears the check-in time when a child is changed to absent", () => {
    const { day } = play([mark(1, "2026-11-18T06:05:00.000Z", "present"), mark(2, "2026-11-18T06:10:00.000Z", "absent")]);
    expect(day).toMatchObject({ status: "absent", checkInAt: null });
  });

  it("two phones offline: the later tap wins whichever arrives first", () => {
    const later = mark(1, "2026-11-18T06:10:00.000Z", "absent");
    const earlier = mark(2, "2026-11-18T06:05:00.000Z", "present");
    const a = play([later, earlier]);
    const b = play([earlier, later]);
    expect(a.day.status).toBe("absent");
    expect(b.day.status).toBe("absent");
    expect(a.results).toEqual(["applied", "stale"]);
  });

  it("checks out only a child who is present, and only once", () => {
    expect(play([checkout(1, "2026-11-18T13:00:00.000Z")]).results).toEqual(["not_checked_in"]);
    const { day, results } = play([
      mark(1, "2026-11-18T06:00:00.000Z", "present"),
      checkout(2, "2026-11-18T13:00:00.000Z"),
      checkout(3, "2026-11-18T13:05:00.000Z"),
      mark(4, "2026-11-18T13:10:00.000Z", "absent"),
    ]);
    expect(results).toEqual(["applied", "applied", "already_checked_out", "already_checked_out"]);
    expect(day).toMatchObject({ status: "present", checkOutAt: "2026-11-18T13:00:00.000Z", collectedByGuardianId: mum });
  });

  it("a refusal never changes the child's day", () => {
    const start = play([mark(1, "2026-11-18T06:00:00.000Z", "present")]).day;
    const r = applyEvent(start, { kind: "refusal", clientUuid: uuid(9), at: "2026-11-18T13:00:00.000Z", studentId: kid, date: "2026-11-18", personName: "Uncle" });
    expect(r).toEqual({ day: start, result: "applied" });
  });
});

describe("attendance summary (spec §9.2)", () => {
  it("counts excused children out of the expected number and flags unmarked children", () => {
    expect(attendanceSummary(["present", "present", "absent", "excused", null])).toEqual({
      present: 2,
      absent: 1,
      excused: 1,
      notMarked: 1,
      expected: 4,
      complete: false,
    });
    expect(attendanceSummary(["present", "excused"]).complete).toBe(true);
    expect(attendanceSummary([]).complete).toBe(false);
  });
});

describe("staff : children ratio (spec §8.3)", () => {
  it("required carers is children ÷ ratio rounded up", () => {
    expect(requiredCarers(0, 4)).toBe(0);
    expect(requiredCarers(1, 4)).toBe(1);
    expect(requiredCarers(12, 4)).toBe(3);
    expect(requiredCarers(13, 4)).toBe(4);
    expect(requiredCarers(8, 3)).toBe(3);
    expect(requiredCarers(5, 0)).toBe(5);
  });

  it("is a breach only when even the unconfirmed carers would not cover it", () => {
    // Spec §16: Norvale Toddlers, 12 children with 2 carers where 1:4 needs 3.
    expect(roomRatio({ childrenPresent: 12, childrenPerStaff: 4, carersConfirmed: 2, carersUnconfirmed: 0 })).toEqual({ required: 3, state: "breach", isBreach: true });
    expect(roomRatio({ childrenPresent: 12, childrenPerStaff: 4, carersConfirmed: 2, carersUnconfirmed: 1 }).state).toBe("unconfirmed");
    expect(roomRatio({ childrenPresent: 12, childrenPerStaff: 4, carersConfirmed: 3, carersUnconfirmed: 0 }).state).toBe("ok");
    expect(roomRatio({ childrenPresent: 0, childrenPerStaff: 4, carersConfirmed: 0, carersUnconfirmed: 0 }).state).toBe("empty");
  });

  it("the manager's tap wins over the fingerprint file", () => {
    expect(carerPresence(true, "absent")).toBe("yes");
    expect(carerPresence(false, "present")).toBe("no");
    expect(carerPresence(null, "late")).toBe("yes");
    expect(carerPresence(null, "leave")).toBe("no");
    expect(carerPresence(null, null)).toBe("unknown");
  });

  it("a roster row for the day moves a person; otherwise they stay in their usual room", () => {
    const staff = [
      { id: "a", defaultRoomId: "r1" },
      { id: "b", defaultRoomId: "r1" },
      { id: "c", defaultRoomId: null },
    ];
    const out = effectiveRoster(staff, [
      { staffId: "b", roomId: "r2", markedPresent: true },
      { staffId: "c", roomId: null, markedPresent: false },
    ]);
    expect(out.map((s) => [s.id, s.roomId, s.markedPresent, s.moved])).toEqual([
      ["a", "r1", null, false],
      ["b", "r2", true, true],
      ["c", null, false, false],
    ]);
  });
});

describe("Cairo wall clock (rule 11)", () => {
  it("converts Cairo wall time to UTC in winter and in summer time", () => {
    expect(cairoWallToUtc(2026, 11, 18, 8, 0).toISOString()).toBe("2026-11-18T06:00:00.000Z");
    expect(cairoWallToUtc(2026, 7, 1, 8, 0).toISOString()).toBe("2026-07-01T05:00:00.000Z");
    expect(cairoOffsetMinutes(new Date("2026-11-18T06:00:00Z"))).toBe(120);
  });

  it("reads back HH:MM in Cairo and counts minutes", () => {
    expect(cairoTimeOf(new Date("2026-11-18T06:07:00Z"))).toBe("08:07");
    expect(cairoTimeOf(new Date("2026-11-18T22:30:00Z"))).toBe("00:30");
    expect(minutesOf("08:10")).toBe(490);
  });
});
