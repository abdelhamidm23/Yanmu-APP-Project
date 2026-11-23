import { describe, expect, it } from "vitest";
import { cellPiastres, egpText, parseTemplate, type TemplateLine } from "@/lib/month-close";

const LINES: TemplateLine[] = [
  { code: "check:billed", kind: "check", label: "Billed", app: 43160000n, categoryId: null },
  { code: "check:expense:food", kind: "check", label: "Food", app: 2345050n, categoryId: "c-food" },
  { code: "central:salaries", kind: "central", label: "Salaries", app: null, categoryId: "c-sal" },
  { code: "balance:cash", kind: "balance", label: "Cash", app: null, categoryId: null },
];
const row = (row: number, ...values: unknown[]) => ({ row, values });

describe("month-close template (spec §8.10)", () => {
  it("reads EGP exactly into piastres, from numbers or text, Arabic digits too", () => {
    expect(cellPiastres(431600)).toBe(43160000n);
    expect(cellPiastres("23,450.50")).toBe(2345050n);
    expect(cellPiastres("١٢٣٫٥")).toBe(12350n);
    expect(cellPiastres(0.1 + 0.2)).toBe(30n);
    expect(cellPiastres("")).toBeNull();
    expect(cellPiastres("abc")).toBe("bad");
    expect(egpText(2345050n)).toBe("23450.50");
    expect(egpText(-5n)).toBe("-0.05");
  });

  it("accepts matching figures, central costs and balances", () => {
    const r = parseTemplate(
      [row(2, "check:billed", "", "431600.00", "431600.00"), row(3, "check:expense:food", "", "", "23450.50"), row(4, "central:salaries", "", "", 210000), row(5, "balance:cash", "", "", "")],
      LINES,
    );
    expect(r.errors).toEqual([]);
    expect(r.lines.map((l) => [l.code, l.amount])).toEqual([
      ["check:billed", 43160000n],
      ["check:expense:food", 2345050n],
      ["central:salaries", 21000000n],
    ]);
  });

  it("a difference needs a note; unknown codes, duplicates and missing check lines are row errors", () => {
    const r = parseTemplate(
      [row(2, "check:billed", "", "", "431500"), row(3, "check:billed", "", "", "431600"), row(4, "rent", "", "", "1"), row(5, "central:salaries", "", "", "x")],
      LINES,
    );
    expect(r.errors.map((e) => [e.row, e.code])).toEqual([
      [2, "noteRequired"],
      [3, "duplicate"],
      [4, "unknownCode"],
      [5, "notNumber"],
      [0, "missing"],
    ]);
    const ok = parseTemplate([row(2, "check:billed", "", "", "431500", "One family billed twice, credit note in Dec"), row(3, "check:expense:food", "", "", "23450.5")], LINES);
    expect(ok.errors).toEqual([]);
    expect(ok.lines[0]).toMatchObject({ amount: 43150000n, app: 43160000n, note: "One family billed twice, credit note in Dec" });
  });
});
