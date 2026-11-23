import { describe, expect, it } from "vitest";
import {
  ageBucket,
  allocate,
  cashVariance,
  daysOfMonth,
  daysOverdue,
  dueDateFor,
  invoiceLines,
  monthEnd,
  monthStart,
  prorate,
  proratedDays,
  shiftMonth,
  type ChildForBilling,
  type FeeItem,
} from "@/lib/billing";

// November 2026 starts on a Sunday: Sunday to Thursday, no holidays → 22 working days.
const NOV = daysOfMonth("2026-11-01").filter((d) => [0, 1, 2, 3, 4].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
const fees: FeeItem[] = [
  { itemType: "tuition", ageBandId: "toddlers", amount: 450000n },
  { itemType: "tuition", ageBandId: null, amount: 400000n },
  { itemType: "registration", ageBandId: null, amount: 150000n },
  { itemType: "transport", ageBandId: null, amount: 80000n },
];
const child = (over: Partial<ChildForBilling> = {}): ChildForBilling => ({
  ageBandId: "toddlers",
  startDate: "2025-09-01",
  priceLocks: [],
  services: [],
  billedBefore: true,
  ...over,
});

describe("dates", () => {
  it("months and due dates", () => {
    expect(monthStart("2026-11-17")).toBe("2026-11-01");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
    expect(shiftMonth("2026-11-17", 2)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-01");
    expect(dueDateFor("2026-11-01", 5)).toBe("2026-11-05");
    expect(dueDateFor("2026-02-01", 31)).toBe("2026-02-28");
    expect(NOV).toHaveLength(22);
  });

  it("days overdue and ageing (spec §9.1)", () => {
    expect(daysOverdue("2026-11-05", "2026-11-05")).toBe(0);
    expect(daysOverdue("2026-11-05", "2026-11-22")).toBe(17);
    expect(daysOverdue("2026-09-05", "2026-11-22")).toBe(78);
    expect(ageBucket(0)).toBeNull();
    expect(ageBucket(1)).toBe("d1_30");
    expect(ageBucket(30)).toBe("d1_30");
    expect(ageBucket(31)).toBe("d31_60");
    expect(ageBucket(60)).toBe("d31_60");
    expect(ageBucket(61)).toBe("d60_plus");
  });
});

describe("pro-rating", () => {
  it("rounds half up to whole piastres", () => {
    expect(prorate(450000n, 12, 21)).toBe(257143n); // 257142.857…
    expect(prorate(100n, 1, 8)).toBe(13n); // 12.5 → 13
    expect(prorate(100n, 1, 3)).toBe(33n);
    expect(prorate(450000n, 21, 21)).toBe(450000n);
    expect(prorate(450000n, 30, 21)).toBe(450000n);
  });
});

describe("invoice lines (spec §8.4.1)", () => {
  it("bills the band's tuition for a full month", () => {
    const r = invoiceLines(child(), fees, [], "2026-11-01", NOV, true);
    expect(r).toEqual({ lines: [{ itemType: "tuition", description: "", unit: 450000n, amount: 450000n, source: "fee_list" }], total: 450000n, prorated: false });
  });

  it("falls back to a fee for every band", () => {
    const r = invoiceLines(child({ ageBandId: "seniors" }), fees, [], "2026-11-01", NOV, true);
    expect("total" in r && r.total).toBe(400000n);
  });

  it("a legacy price lock wins over the fee list (D7)", () => {
    const r = invoiceLines(
      child({ priceLocks: [{ itemType: "tuition", amount: 380000n, startsOn: "2025-01-01", endsOn: null }] }),
      fees,
      [],
      "2026-11-01",
      NOV,
      true,
    );
    expect("lines" in r && r.lines[0]).toMatchObject({ source: "price_lock", amount: 380000n });
  });

  it("an ended price lock no longer applies", () => {
    const r = invoiceLines(
      child({ priceLocks: [{ itemType: "tuition", amount: 380000n, startsOn: "2025-01-01", endsOn: "2026-10-31" }] }),
      fees,
      [],
      "2026-11-01",
      NOV,
      true,
    );
    expect("lines" in r && r.lines[0]).toMatchObject({ source: "fee_list", amount: 450000n });
  });

  it("pro-rates a new child by working days from the start, and adds registration once", () => {
    // Starts Tuesday 17 Nov: 17,18,19 + 22–26 + 29,30 = 10 working days of 22.
    const r = invoiceLines(child({ startDate: "2026-11-17", billedBefore: false }), fees, [], "2026-11-01", NOV, true);
    expect(r).toEqual({
      lines: [
        { itemType: "tuition", description: "10/22", unit: 450000n, amount: 204545n, source: "fee_list" },
        { itemType: "registration", description: "", unit: 150000n, amount: 150000n, source: "fee_list" },
      ],
      total: 354545n,
      prorated: true,
    });
  });

  it("no pro-rating when the setting is off", () => {
    const r = invoiceLines(child({ startDate: "2026-11-17" }), fees, [], "2026-11-01", NOV, false);
    expect("total" in r && r.total).toBe(450000n);
  });

  it("transport only while the child takes it", () => {
    const withBus = invoiceLines(child({ services: [{ itemType: "transport", startsOn: "2026-10-01", endsOn: null }] }), fees, [], "2026-11-01", NOV, true);
    expect("total" in withBus && withBus.total).toBe(530000n);
    const stopped = invoiceLines(child({ services: [{ itemType: "transport", startsOn: "2026-09-01", endsOn: "2026-10-31" }] }), fees, [], "2026-11-01", NOV, true);
    expect("total" in stopped && stopped.total).toBe(450000n);
  });

  it("applies discounts in force (none are active at launch, D6)", () => {
    const r = invoiceLines(
      child(),
      fees,
      [
        { name: "Siblings 10%", type: "percent", value: 1000n, appliesTo: "tuition", startsOn: "2026-09-01", endsOn: null },
        { name: "Old offer", type: "amount", value: 50000n, appliesTo: "tuition", startsOn: "2025-01-01", endsOn: "2025-12-31" },
      ],
      "2026-11-01",
      NOV,
      true,
    );
    expect("lines" in r && r.lines[1]).toEqual({ itemType: "tuition", description: "Siblings 10%", unit: -45000n, amount: -45000n, source: "discount" });
    expect("total" in r && r.total).toBe(405000n);
  });

  it("refuses a child with no fee, or one starting after the month", () => {
    expect(invoiceLines(child(), [], [], "2026-11-01", NOV, true)).toEqual({ error: "no_fee" });
    expect(invoiceLines(child({ startDate: "2026-12-01" }), fees, [], "2026-11-01", NOV, true)).toEqual({ error: "not_started" });
  });

  it("reads the pro-rated days back", () => {
    expect(proratedDays("10/21")).toEqual([10, 21]);
    expect(proratedDays("")).toBeNull();
  });
});

describe("payment allocation (spec §8.4.3)", () => {
  const open = [
    { id: "lf-oct", kind: "late_fee" as const, dueDate: "2026-10-06", balance: 150000n },
    { id: "nov", kind: "tuition" as const, dueDate: "2026-11-05", balance: 450000n },
    { id: "oct", kind: "tuition" as const, dueDate: "2026-10-05", balance: 200000n },
  ];

  it("pays the oldest tuition first, then late fees", () => {
    expect(allocate(700000n, open)).toEqual({
      allocations: [
        { invoiceId: "oct", amount: 200000n },
        { invoiceId: "nov", amount: 450000n },
        { invoiceId: "lf-oct", amount: 50000n },
      ],
      credit: 0n,
    });
  });

  it("keeps what is left as credit on the family's account", () => {
    expect(allocate(900000n, open).credit).toBe(100000n);
    expect(allocate(100000n, [])).toEqual({ allocations: [], credit: 100000n });
  });

  it("a part payment stops on the first invoice", () => {
    expect(allocate(150000n, open).allocations).toEqual([{ invoiceId: "oct", amount: 150000n }]);
  });
});

describe("cash box (spec §8.5)", () => {
  it("variance = opening + in − out − handed over − counted", () => {
    expect(cashVariance({ opening: 100000n, cashIn: 1250000n, cashOut: 80000n, handedOver: 1200000n, counted: 70000n })).toBe(0n);
    expect(cashVariance({ opening: 100000n, cashIn: 1250000n, cashOut: 80000n, handedOver: 1200000n, counted: 45000n })).toBe(25000n);
    expect(cashVariance({ opening: 100000n, cashIn: 0n, cashOut: 0n, handedOver: 0n, counted: 110000n })).toBe(-10000n);
  });
});
