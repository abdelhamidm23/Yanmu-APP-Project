import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { isWorkingDay, todayInCairo, weekdayOf } from "@/lib/calendar";
import { SETTINGS, parseSettingInput } from "@/lib/settings";
import { auditChanges } from "@/lib/audit-diff";
import { grantKey, parseGrants, temporaryPassword } from "../../src/app/[locale]/(app)/settings/users/grants";

const BRANCH = "6f1c1d1e-2b3a-4c5d-8e9f-0a1b2c3d4e5f";

describe("calendar", () => {
  it("knows the weekday of a plain date", () => {
    expect(weekdayOf("2026-11-20")).toBe("fri");
    expect(weekdayOf("2026-11-22")).toBe("sun");
    expect(weekdayOf("2028-02-29")).toBe("tue");
  });

  it("uses the weekly pattern, with explicit days winning", () => {
    const pattern = ["sun", "mon", "tue", "wed", "thu"] as const;
    const none = new Map<string, boolean>();
    expect(isWorkingDay("2026-11-22", pattern, none)).toBe(true); // Sunday
    expect(isWorkingDay("2026-11-20", pattern, none)).toBe(false); // Friday
    expect(isWorkingDay("2026-11-22", pattern, new Map([["2026-11-22", false]]))).toBe(false); // holiday
    expect(isWorkingDay("2026-11-21", pattern, new Map([["2026-11-21", true]]))).toBe(true); // make-up Saturday
  });

  it("gives today's date in Cairo, not UTC", () => {
    // 23:30 UTC on 19 Nov is 01:30 on 20 Nov in Cairo (UTC+2).
    expect(todayInCairo(new Date("2026-11-19T23:30:00Z"))).toBe("2026-11-20");
    expect(todayInCairo(new Date("2026-11-19T21:30:00Z"))).toBe("2026-11-19");
  });
});

describe("threshold input", () => {
  it("turns pounds into whole piastres without floating point", () => {
    expect(parseSettingInput("late_fee.daily_piastres", "500")).toBe(50000);
    expect(parseSettingInput("late_fee.daily_piastres", "12.5")).toBe(1250);
    expect(parseSettingInput("late_fee.daily_piastres", "0.29")).toBe(29);
    expect(parseSettingInput("approvals.branch_manager_limit_piastres", "20,000")).toBe(2000000);
  });

  it("rejects bad money", () => {
    for (const bad of ["", "-5", "1.234", "abc", "1e3"]) {
      expect(() => parseSettingInput("late_fee.daily_piastres", bad)).toThrow(ZodError);
    }
  });

  it("treats an empty cap as no cap", () => {
    expect(parseSettingInput("late_fee.cap_piastres", "")).toBeNull();
    expect(parseSettingInput("late_fee.cap_piastres", "3000")).toBe(300000);
  });

  it("checks days, times, choices and multipliers", () => {
    expect(parseSettingInput("billing.due_day", "5")).toBe(5);
    expect(() => parseSettingInput("billing.due_day", "31")).toThrow(ZodError);
    expect(parseSettingInput("ratio.snapshot_time", "10:00")).toBe("10:00");
    expect(() => parseSettingInput("ratio.snapshot_time", "25:00")).toThrow(ZodError);
    expect(parseSettingInput("late_fee.basis", "per_family")).toBe("per_family");
    expect(() => parseSettingInput("late_fee.basis", "per_child")).toThrow(ZodError);
    expect(parseSettingInput("approvals.unusual_multiplier", "2.5")).toBe(2.5);
    expect(parseSettingInput("calendar.working_days", ["sun", "mon"])).toEqual(["sun", "mon"]);
    expect(() => parseSettingInput("calendar.working_days", [])).toThrow(ZodError);
  });

  it("has a valid default for every setting", () => {
    for (const s of SETTINGS) expect(() => (s.schema as { parse: (v: unknown) => unknown }).parse(s.default)).not.toThrow();
  });
});

describe("role grants", () => {
  it("reads checkbox values", () => {
    const grants = parseGrants(["accountant:all", `teacher:${BRANCH}`]);
    expect(grants).toEqual([
      { role: "accountant", branchId: null },
      { role: "teacher", branchId: BRANCH },
    ]);
    expect(grants.map(grantKey)).toEqual(["accountant:all", `teacher:${BRANCH}`]);
  });

  it("refuses branch roles for all branches and owner for one branch", () => {
    expect(() => parseGrants(["teacher:all"])).toThrow(ZodError);
    expect(() => parseGrants([`owner:${BRANCH}`])).toThrow(ZodError);
    expect(() => parseGrants(["janitor:all"])).toThrow(ZodError);
  });

  it("makes readable temporary passwords", () => {
    expect(temporaryPassword()).toMatch(/^[A-Z][a-z]+-\d{4}-[A-Z][a-z]+$/);
  });
});

describe("audit changes", () => {
  it("lists only fields that changed, without timestamps", () => {
    const before = { id: "1", capacity: 10, name_en: "Sun", updated_at: "a" };
    const after = { id: "1", capacity: 12, name_en: "Sun", updated_at: "b" };
    expect(auditChanges("update", before, after)).toEqual([{ field: "capacity", from: "10", to: "12" }]);
  });

  it("summarises added and removed rows by their names", () => {
    expect(auditChanges("insert", null, { id: "1", name_en: "Sun room", capacity: 10 })).toEqual([{ field: "name_en", to: "Sun room" }]);
    expect(auditChanges("delete", { date: "2026-12-25", note: "Holiday" }, null)).toEqual([
      { field: "date", to: "2026-12-25" },
      { field: "note", to: "Holiday" },
    ]);
  });
});
