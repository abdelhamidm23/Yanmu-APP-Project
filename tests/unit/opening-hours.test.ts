import { describe, expect, it } from "vitest";
import { stillInAlertTime } from "@/lib/attendance";
import { SETTINGS } from "@/lib/settings";

describe("opening hours (owner's review)", () => {
  it("defaults to 08:00 to 16:00 with a 60-minute after-school time", () => {
    const get = (key: string) => SETTINGS.find((s) => s.key === key)?.default;
    expect(get("attendance.opening_time")).toBe("08:00");
    expect(get("attendance.closing_time")).toBe("16:00");
    expect(get("attendance.after_school_minutes")).toBe(60);
    expect(get("calendar.working_days")).toEqual(["sun", "mon", "tue", "wed", "thu"]);
  });

  it("alerts about children still in once the after-school time has ended", () => {
    expect(stillInAlertTime("16:00", 60)).toBe("17:00");
    expect(stillInAlertTime("16:00", 0)).toBe("16:00");
    expect(stillInAlertTime("15:30", 45)).toBe("16:15");
    expect(stillInAlertTime("23:30", 120)).toBe("23:59");
  });
});
