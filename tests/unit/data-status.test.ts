import { describe, expect, it } from "vitest";
import { consolidate, fromRow, percentText, weakest, type KpiRow } from "@/lib/data-status";

const row = (r: Partial<KpiRow> & { key: string }): KpiRow => ({ value: null, num: null, den: null, status: "provisional", done: null, total: null, ...r });

describe("data status (spec §6.1)", () => {
  it("a consolidated figure takes the weakest status of its parts", () => {
    expect(weakest(["verified", "provisional"])).toBe("provisional");
    expect(weakest(["verified", "confirmed"])).toBe("confirmed");
    expect(weakest(["provisional", "incomplete", "verified"])).toBe("incomplete");
    expect(weakest(["incomplete", "notSubmitted"])).toBe("notSubmitted");
    expect(weakest([])).toBe("notSubmitted");
  });

  it("a figure nobody submitted has no value, never zero (rule 1)", () => {
    const k = fromRow(row({ key: "staff.present", value: "0", num: "0", status: "not_submitted" }));
    expect(k.value).toBeNull();
    expect(k.status).toBe("notSubmitted");
  });

  it("attendance across branches is worked out from the parts (spec §16: 125 of 137 = 91%)", () => {
    const a = fromRow(row({ key: "attendance.day", value: "92.1", num: "82", den: "89", status: "provisional", done: 6, total: 6 }));
    const b = fromRow(row({ key: "attendance.day", value: "89.6", num: "43", den: "48", status: "incomplete", done: 6, total: 8 }));
    const [all] = consolidate([[a], [b]]);
    expect(all).toMatchObject({ value: "91.2", num: "125", den: "137", status: "incomplete", done: 12, total: 14 });
  });

  it("money adds up in piastres without floats", () => {
    const a = fromRow(row({ key: "money.billed", value: "43160000", num: "43160000", status: "verified" }));
    const b = fromRow(row({ key: "money.billed", value: "23180001", num: "23180001", status: "provisional" }));
    expect(consolidate([[a], [b]])[0]).toMatchObject({ value: "66340001", status: "provisional" });
  });

  it("incident rate per 100 children (spec §16: 6 of 153 = 3.9)", () => {
    expect(percentText("6", "153")).toBe("3.9");
    expect(percentText("2", "92")).toBe("2.2");
    expect(percentText("4", "61")).toBe("6.6");
    expect(percentText("1", "0")).toBeNull();
    expect(percentText("-5", "200")).toBe("-2.5");
  });

  it("a branch that has not submitted leaves the total unsubmitted parts out but marks it", () => {
    const a = fromRow(row({ key: "staff.present", value: "24", num: "24", den: "26", status: "provisional" }));
    const b = fromRow(row({ key: "staff.present", value: null, num: null, den: "17", status: "not_submitted" }));
    expect(consolidate([[a], [b]])[0]).toMatchObject({ value: null, status: "notSubmitted" });
  });
});
