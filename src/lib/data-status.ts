import type { DataStatus } from "@/components/ui/StatusChip";

/**
 * Data status of a figure (spec §6.1) and how figures of several branches add up: a consolidated
 * figure takes the weakest status of its parts. Rates are worked out again from their parts,
 * never averaged.
 */
export const STATUS_ORDER: DataStatus[] = ["notSubmitted", "incomplete", "provisional", "confirmed", "verified"];

/** The database's spelling (snake case) to the chip's. */
export function toStatus(s: string): DataStatus {
  return s === "not_submitted" ? "notSubmitted" : (STATUS_ORDER as string[]).includes(s) ? (s as DataStatus) : "incomplete";
}

export function weakest(statuses: readonly DataStatus[]): DataStatus {
  if (statuses.length === 0) return "notSubmitted";
  return statuses.reduce((w, s) => (STATUS_ORDER.indexOf(s) < STATUS_ORDER.indexOf(w) ? s : w));
}

export type KpiKind = "count" | "percent" | "piastres" | "rate";

/** Every figure app_kpis() returns (drizzle/0015), in the order the figures page shows them. */
export const KPI_DEFS: { key: string; kind: KpiKind; group: "children" | "team" | "safety" | "closing" | "money" }[] = [
  { key: "children.active", kind: "count", group: "children" },
  { key: "children.occupancy", kind: "percent", group: "children" },
  { key: "attendance.day", kind: "percent", group: "children" },
  { key: "staff.present", kind: "count", group: "team" },
  { key: "ratio.breaches", kind: "count", group: "team" },
  { key: "incidents.day", kind: "count", group: "safety" },
  { key: "incidents.month", kind: "count", group: "safety" },
  { key: "incidents.rate", kind: "rate", group: "safety" },
  { key: "incidents.open_critical", kind: "count", group: "safety" },
  { key: "actions.overdue", kind: "count", group: "safety" },
  { key: "close.day", kind: "count", group: "closing" },
  { key: "close.rate", kind: "percent", group: "closing" },
  { key: "money.billed", kind: "piastres", group: "money" },
  { key: "money.collected", kind: "piastres", group: "money" },
  { key: "money.collected_day", kind: "piastres", group: "money" },
  { key: "money.collection_rate", kind: "percent", group: "money" },
  { key: "money.overdue", kind: "piastres", group: "money" },
  { key: "money.late_fees_outstanding", kind: "piastres", group: "money" },
  { key: "money.expenses", kind: "piastres", group: "money" },
  { key: "money.result", kind: "piastres", group: "money" },
];

/** One figure as the database gives it (numbers arrive as text so piastres never pass through a float). */
export type KpiRow = {
  key: string;
  value: string | null;
  num: string | null;
  den: string | null;
  status: string;
  done: number | null;
  total: number | null;
};

export type Kpi = {
  key: string;
  kind: KpiKind;
  /** null = not submitted: shown as "—", never as zero (rule 1). */
  value: string | null;
  num: string | null;
  den: string | null;
  status: DataStatus;
  done: number | null;
  total: number | null;
};

const kindOf = (key: string): KpiKind => KPI_DEFS.find((d) => d.key === key)?.kind ?? "count";

export function fromRow(r: KpiRow): Kpi {
  const status = toStatus(r.status);
  return { key: r.key, kind: kindOf(r.key), value: status === "notSubmitted" ? null : r.value, num: r.num, den: r.den, status, done: r.done, total: r.total };
}

/** Whole-number sum of texts (piastres and counts), without floats. */
function sumText(values: (string | null)[]): string | null {
  const present = values.filter((v): v is string => v !== null && v !== "");
  if (present.length === 0) return null;
  return present.reduce((s, v) => s + BigInt(v.split(".")[0]), 0n).toString();
}

/** One decimal place of a ÷ b × 100 (or × per), in integer arithmetic. */
export function percentText(num: string, den: string, per = 100n): string | null {
  let n = BigInt(num.split(".")[0]);
  let d = BigInt(den.split(".")[0]);
  if (d === 0n) return null;
  const negative = n < 0n !== d < 0n && n !== 0n;
  if (n < 0n) n = -n;
  if (d < 0n) d = -d;
  const tenths = (n * per * 10n * 2n + d) / (d * 2n); // rounded half away from zero
  return `${negative ? "-" : ""}${tenths / 10n}.${tenths % 10n}`;
}

/** "All branches": sums the parts, works rates out again, and takes the weakest status. */
export function consolidate(parts: Kpi[][]): Kpi[] {
  const byKey = new Map<string, Kpi[]>();
  for (const branch of parts) for (const k of branch) byKey.set(k.key, [...(byKey.get(k.key) ?? []), k]);
  return [...byKey.entries()].map(([key, ks]) => {
    const kind = kindOf(key);
    const status = weakest(ks.map((k) => k.status));
    const num = sumText(ks.map((k) => (k.status === "notSubmitted" ? null : k.num)));
    const den = sumText(ks.map((k) => k.den));
    const done = ks.every((k) => k.done === null) ? null : ks.reduce((s, k) => s + (k.done ?? 0), 0);
    const total = ks.every((k) => k.total === null) ? null : ks.reduce((s, k) => s + (k.total ?? 0), 0);
    let value: string | null;
    if (status === "notSubmitted") value = null;
    else if (kind === "percent" || kind === "rate") value = num !== null && den !== null ? percentText(num, den) : null;
    else value = num;
    return { key, kind, value, num, den, status, done, total };
  });
}
