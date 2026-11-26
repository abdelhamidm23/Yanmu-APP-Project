/**
 * The owner's Home (spec §11.2): the "Requires your attention" ranking (§9.6), the daily briefing built from
 * fixed template sentences (§9.7) and the normalized branch comparison (§9.5). Pure functions: the database
 * layer (src/db/home.ts) gathers the records, these decide what to say. Money stays integer piastres (rule 5).
 */
import { percentText } from "./data-status";

// ---------------------------------------------------------------------------
// Requires your attention (spec §9.6)
// ---------------------------------------------------------------------------

export const ATTENTION_KINDS = [
  "critical_incident",
  "approval",
  "reopen",
  "over_capacity",
  "overdue_family",
  "ratio_breach",
  "close_missing",
  "expense_rise",
  "occupancy_drop",
  "cash_variance",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** Severity order of spec §9.6: 1 is the most urgent. */
export const ATTENTION_RANK: Record<AttentionKind, number> = {
  critical_incident: 1,
  approval: 2,
  reopen: 2,
  over_capacity: 2,
  overdue_family: 3,
  ratio_breach: 4,
  close_missing: 4,
  expense_rise: 5,
  occupancy_drop: 6,
  cash_variance: 7,
};

export type AttentionItem = {
  kind: AttentionKind;
  /** Unique within its kind (a record id, or branch + date). */
  id: string;
  branchId: string;
  /** When it started: the oldest goes first within a rank. ISO timestamp. */
  at: string;
  /** Where its one action button goes. */
  href: string;
  /** Values for the row's sentence (counts, names, amounts in piastres as bigint). */
  values: Record<string, string | number | bigint>;
};

/** Ranked by severity, then age (oldest first); ties by kind and id so the order never jumps. */
export function rankAttention(items: readonly AttentionItem[]): AttentionItem[] {
  return [...items].sort(
    (a, b) =>
      ATTENTION_RANK[a.kind] - ATTENTION_RANK[b.kind] ||
      a.at.localeCompare(b.at) ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id),
  );
}

/** At most this many rows on Home; the rest are in the Inbox. */
export const HOME_ATTENTION_ROWS = 4;

/** A family is flagged when its oldest unpaid bill is more than `days` overdue or it owes more than `amount`. */
export function overdueFamilyFlagged(f: { days: number; amount: bigint }, limits: { days: number; amount: bigint }): boolean {
  return f.days > limits.days || f.amount > limits.amount;
}

/** An expense category is unusual when this month so far is more than `percent` above its 3-month average. */
export function expenseRise(monthToDate: bigint, lastThreeMonths: bigint, percent: number): boolean {
  if (lastThreeMonths <= 0n) return false;
  // mtd > (sum ÷ 3) × (100 + p) ÷ 100, without division.
  return monthToDate * 300n > lastThreeMonths * BigInt(100 + percent);
}

/** Occupancy points lost since the same day last month, against licensed capacity. */
export function occupancyDrop(before: number, now: number, licensed: number, points: number): boolean {
  if (licensed <= 0) return false;
  return (before - now) * 100 >= points * licensed;
}

// ---------------------------------------------------------------------------
// Daily briefing (spec §9.7): fixed sentences, never free text
// ---------------------------------------------------------------------------

export type BriefingInput = {
  working: boolean;
  attendance: { present: number; expected: number; classesDone: number; classes: number; missingClasses: string[] };
  incidents: { today: number; confirmedNone: boolean; closeTime: string };
  openCritical: number;
  /** Only for people who see money. */
  money: { collected: bigint; overdueFamilies: number } | null;
  staff: { uploaded: boolean; absent: number };
  ratioBreaches: number;
  /** Branch days not closed (past working days, and today after the alert time). */
  notClosed: { branch: string; date: string }[];
};

export type Sentence = { key: string; values: Record<string, string | number | bigint | string[]> };

export function buildBriefing(b: BriefingInput): Sentence[] {
  const out: Sentence[] = [];
  if (!b.working) {
    out.push({ key: "notWorking", values: {} });
  } else if (b.attendance.classesDone === 0) {
    out.push({ key: "attendanceNone", values: { classes: b.attendance.classes } });
  } else {
    const pct = b.attendance.expected > 0 ? percentText(String(b.attendance.present), String(b.attendance.expected)) ?? "0.0" : null;
    if (pct === null) out.push({ key: "attendanceNoneExpected", values: {} });
    else if (b.attendance.missingClasses.length === 0)
      out.push({ key: "attendanceAll", values: { pct: pct.replace(/\.0$/, ""), present: b.attendance.present, expected: b.attendance.expected } });
    else
      out.push({
        key: "attendanceMissing",
        values: {
          pct: pct.replace(/\.0$/, ""),
          present: b.attendance.present,
          expected: b.attendance.expected,
          missing: b.attendance.missingClasses,
          count: b.attendance.missingClasses.length,
        },
      });
  }
  if (b.working) {
    if (b.incidents.today > 0) out.push({ key: "incidentsToday", values: { count: b.incidents.today } });
    else if (b.incidents.confirmedNone) out.push({ key: "incidentsNoneConfirmed", values: {} });
    else out.push({ key: "incidentsNoneYet", values: { time: b.incidents.closeTime } });
  }
  if (b.openCritical > 0) out.push({ key: "critical", values: { count: b.openCritical } });
  if (b.money) out.push({ key: "money", values: { collected: b.money.collected, families: b.money.overdueFamilies } });
  if (b.working) {
    if (!b.staff.uploaded) out.push({ key: "staffNotUploaded", values: {} });
    else if (b.staff.absent > 0) out.push({ key: "staffAbsent", values: { count: b.staff.absent } });
    else out.push({ key: "staffAllIn", values: {} });
    if (b.ratioBreaches > 0) out.push({ key: "ratio", values: { count: b.ratioBreaches } });
  }
  for (const d of b.notClosed) out.push({ key: "notClosed", values: { branch: d.branch, date: d.date } });
  return out;
}

// ---------------------------------------------------------------------------
// Branch comparison (spec §9.5), normalized per active child
// ---------------------------------------------------------------------------

export type BranchMonth = {
  branchId: string;
  /** Active children on the month's last day (or today for the current month). */
  active: number;
  licensed: number;
  monthClosed: boolean;
  billed: bigint;
  /** Expenses recorded in the app. */
  appExpenses: bigint;
  /** Costs paid centrally, from the month-close template (salaries, rent …); null before the upload. */
  central: bigint | null;
  salaries: bigint | null;
  collectionRate: string | null;
  incidents: number;
  overdue: bigint;
};

export const COMPARISON_METRICS = [
  { key: "revenuePerChild", better: "higher", kind: "piastres" },
  { key: "costPerChild", better: "lower", kind: "piastres" },
  { key: "resultPerChild", better: "higher", kind: "piastres" },
  { key: "staffCostRatio", better: "lower", kind: "percent" },
  { key: "collectionRate", better: "higher", kind: "percent" },
  { key: "occupancy", better: "higher", kind: "percent" },
  { key: "incidentRate", better: "lower", kind: "rate" },
  { key: "overduePerChild", better: "lower", kind: "piastres" },
  { key: "breakEven", better: "lower", kind: "percent" },
] as const;
export type MetricKey = (typeof COMPARISON_METRICS)[number]["key"];

/** Rounded half up integer division of piastres. */
export function divRound(a: bigint, b: bigint): bigint {
  if (b === 0n) return 0n;
  const neg = a < 0n !== b < 0n && a !== 0n;
  const x = a < 0n ? -a : a;
  const y = b < 0n ? -b : b;
  const q = (x * 2n + y) / (y * 2n);
  return neg ? -q : q;
}

/** One branch's normalized figures; null where the inputs are missing (shown as "—", never 0). */
export function branchMetrics(m: BranchMonth): Record<MetricKey, bigint | string | null> {
  const a = BigInt(m.active);
  const costs = m.central === null ? null : m.appExpenses + m.central;
  const perChild = (v: bigint | null) => (v === null || a === 0n ? null : divRound(v, a));
  // Break-even occupancy = fixed costs ÷ ((average net fee − variable cost per child) × licensed capacity).
  let breakEven: string | null = null;
  if (m.central !== null && a > 0n && m.licensed > 0) {
    const margin = divRound(m.billed, a) - divRound(m.appExpenses, a);
    if (margin > 0n) breakEven = percentText(m.central.toString(), (margin * BigInt(m.licensed)).toString());
  }
  return {
    revenuePerChild: perChild(m.billed),
    costPerChild: perChild(costs),
    resultPerChild: perChild(costs === null ? null : m.billed - costs),
    // Salaries ÷ revenue, closed months only (spec §9.5).
    staffCostRatio: m.monthClosed && m.salaries !== null && m.billed > 0n ? percentText(m.salaries.toString(), m.billed.toString()) : null,
    collectionRate: m.collectionRate,
    occupancy: m.licensed > 0 ? percentText(String(m.active), String(m.licensed)) : null,
    incidentRate: a > 0n ? percentText(String(m.incidents), String(m.active)) : null,
    overduePerChild: perChild(m.overdue),
    breakEven,
  };
}

/** Compares as exact decimals (one decimal place at most) or bigints. */
function asTenths(v: bigint | string): bigint {
  if (typeof v === "bigint") return v * 10n;
  const [i, f = "0"] = v.split(".");
  const neg = i.startsWith("-");
  const whole = BigInt(i.replace("-", "")) * 10n + BigInt(f.slice(0, 1).padEnd(1, "0"));
  return neg ? -whole : whole;
}

/** The branches with the better value of a metric; none when fewer than two values exist or all are equal. */
export function betterBranches(values: { branchId: string; value: bigint | string | null }[], better: "higher" | "lower"): Set<string> {
  const present = values.filter((v): v is { branchId: string; value: bigint | string } => v.value !== null);
  if (present.length < 2) return new Set();
  const nums = present.map((v) => asTenths(v.value));
  const best = nums.reduce((m, x) => (better === "higher" ? (x > m ? x : m) : x < m ? x : m));
  if (nums.every((x) => x === best)) return new Set();
  return new Set(present.filter((_, i) => nums[i] === best).map((v) => v.branchId));
}
