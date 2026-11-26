import { describe, expect, it } from "vitest";
import {
  betterBranches,
  branchMetrics,
  buildBriefing,
  divRound,
  expenseRise,
  occupancyDrop,
  overdueFamilyFlagged,
  rankAttention,
  type AttentionItem,
  type BriefingInput,
} from "@/lib/home";
import { formatPiastresCompact } from "@/lib/format";

const item = (kind: AttentionItem["kind"], at: string, id = at): AttentionItem => ({ kind, id, branchId: "b", at, href: "/", values: {} });

describe("requires your attention (spec §9.6)", () => {
  it("ranks by severity, then oldest first", () => {
    const ranked = rankAttention([
      item("cash_variance", "2026-11-01T08:00:00Z"),
      item("overdue_family", "2026-09-01T08:00:00Z"),
      item("approval", "2026-11-20T08:00:00Z"),
      item("critical_incident", "2026-11-23T10:00:00Z"),
      item("approval", "2026-11-19T08:00:00Z"),
      item("ratio_breach", "2026-11-23T09:00:00Z"),
      item("close_missing", "2026-11-22T21:00:00Z"),
    ]);
    expect(ranked.map((r) => `${r.kind}@${r.at.slice(5, 10)}`)).toEqual([
      "critical_incident@11-23",
      "approval@11-19",
      "approval@11-20",
      "overdue_family@09-01",
      "close_missing@11-22",
      "ratio_breach@11-23",
      "cash_variance@11-01",
    ]);
  });

  it("flags families by days or amount (settings 60 days / EGP 15,000)", () => {
    const limits = { days: 60, amount: 1_500_000n };
    expect(overdueFamilyFlagged({ days: 61, amount: 100n }, limits)).toBe(true);
    expect(overdueFamilyFlagged({ days: 60, amount: 1_500_000n }, limits)).toBe(false);
    expect(overdueFamilyFlagged({ days: 3, amount: 1_500_001n }, limits)).toBe(true);
  });

  it("finds an expense category 20% above its 3-month average", () => {
    // Average 1,000 → limit 1,200.
    expect(expenseRise(120_000n, 300_000n, 20)).toBe(false);
    expect(expenseRise(120_001n, 300_000n, 20)).toBe(true);
    expect(expenseRise(500n, 0n, 20)).toBe(false);
  });

  it("finds occupancy down 5 points against licensed capacity", () => {
    expect(occupancyDrop(92, 87, 100, 5)).toBe(true);
    expect(occupancyDrop(92, 88, 100, 5)).toBe(false);
    expect(occupancyDrop(10, 0, 0, 5)).toBe(false);
  });
});

const base: BriefingInput = {
  working: true,
  attendance: { present: 125, expected: 137, classesDone: 12, classes: 14, missingClasses: ["Toddlers 1", "Juniors 2"] },
  incidents: { today: 0, confirmedNone: false, closeTime: "19:00" },
  openCritical: 1,
  money: { collected: 52_420_000n, overdueFamilies: 51 },
  staff: { uploaded: true, absent: 4 },
  ratioBreaches: 1,
  notClosed: [{ branch: "Norvale", date: "2026-11-22" }],
};

describe("daily briefing (spec §9.7)", () => {
  it("uses the template sentences with today's figures", () => {
    const s = buildBriefing(base);
    expect(s.map((x) => x.key)).toEqual(["attendanceMissing", "incidentsNoneYet", "critical", "money", "staffAbsent", "ratio", "notClosed"]);
    expect(s[0].values).toMatchObject({ pct: "91.2", present: 125, expected: 137, count: 2 });
    expect(s[1].values).toEqual({ time: "19:00" });
  });

  it("says when nothing was submitted, never zero", () => {
    const s = buildBriefing({
      ...base,
      attendance: { present: 0, expected: 0, classesDone: 0, classes: 14, missingClasses: [] },
      staff: { uploaded: false, absent: 0 },
      incidents: { today: 0, confirmedNone: true, closeTime: "19:00" },
      money: null,
      openCritical: 0,
      ratioBreaches: 0,
      notClosed: [],
    });
    expect(s.map((x) => x.key)).toEqual(["attendanceNone", "incidentsNoneConfirmed", "staffNotUploaded"]);
  });

  it("on a day off only the standing facts are told", () => {
    const s = buildBriefing({ ...base, working: false, notClosed: [] });
    expect(s.map((x) => x.key)).toEqual(["notWorking", "critical", "money"]);
  });

  it("whole percentages lose the .0", () => {
    const s = buildBriefing({ ...base, attendance: { present: 9, expected: 10, classesDone: 2, classes: 2, missingClasses: [] } });
    expect(s[0]).toEqual({ key: "attendanceAll", values: { pct: "90", present: 9, expected: 10 } });
  });
});

describe("branch comparison (spec §9.5)", () => {
  const a = {
    branchId: "A", active: 92, licensed: 100, monthClosed: true, billed: 42_890_000n, appExpenses: 5_120_000n,
    central: 30_000_000n, salaries: 22_000_000n, collectionRate: "90.0", incidents: 2, overdue: 12_470_000n,
  };
  it("normalizes per active child in whole piastres", () => {
    const m = branchMetrics(a);
    expect(m.revenuePerChild).toBe(466_196n); // 42,890,000 ÷ 92 = 466,195.65 → 466,196
    expect(m.costPerChild).toBe(divRound(35_120_000n, 92n));
    expect(m.resultPerChild).toBe(divRound(7_770_000n, 92n));
    expect(m.staffCostRatio).toBe("51.3");
    expect(m.occupancy).toBe("92.0");
    expect(m.incidentRate).toBe("2.2");
    // fixed 300,000 ÷ ((4,661.96 − 556.52) × 100)
    expect(m.breakEven).toBe(percentOf(30_000_000n, (466_196n - 55_652n) * 100n));
  });

  it("leaves costs and break-even empty before the month-close upload", () => {
    const m = branchMetrics({ ...a, central: null, salaries: null, monthClosed: false });
    expect(m.costPerChild).toBeNull();
    expect(m.resultPerChild).toBeNull();
    expect(m.staffCostRatio).toBeNull();
    expect(m.breakEven).toBeNull();
  });

  it("marks the better branch, and nobody when equal or alone", () => {
    expect([...betterBranches([{ branchId: "A", value: "92.0" }, { branchId: "B", value: "61.0" }], "higher")]).toEqual(["A"]);
    expect([...betterBranches([{ branchId: "A", value: 5n }, { branchId: "B", value: 9n }], "lower")]).toEqual(["A"]);
    expect(betterBranches([{ branchId: "A", value: "1.0" }, { branchId: "B", value: "1" }], "higher").size).toBe(0);
    expect(betterBranches([{ branchId: "A", value: "1.0" }, { branchId: "B", value: null }], "higher").size).toBe(0);
    expect([...betterBranches([{ branchId: "A", value: "-15.3" }, { branchId: "B", value: "2.0" }], "higher")]).toEqual(["B"]);
  });
});

function percentOf(a: bigint, b: bigint) {
  const tenths = (a * 1000n * 2n + b) / (b * 2n);
  return `${tenths / 10n}.${tenths % 10n}`;
}

describe("compact money for tiles", () => {
  it("rounds to tenths of thousands and millions", () => {
    expect(formatPiastresCompact(66_340_000n, "en", "latin")).toBe("663.4K");
    expect(formatPiastresCompact(-1_530_000n, "en", "latin")).toBe("−15.3K");
    expect(formatPiastresCompact(99_000n, "en", "latin")).toBe("990");
    expect(formatPiastresCompact(123_456_789n, "en", "latin")).toBe("1.2M");
    expect(formatPiastresCompact(66_340_000n, "ar", "arabic")).toBe("٦٦٣٫٤ ألف");
  });
});
