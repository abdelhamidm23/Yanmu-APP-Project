/**
 * Billing calculations (spec §8.4): invoice lines for a child and month, pro-rating, discounts,
 * payment allocation, ageing and the cash box difference. Pure functions on integer piastres
 * (bigint, rule 5), so every result is exact and unit-tested.
 */

export const ITEM_TYPES = ["tuition", "registration", "transport", "service"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
/** Extras a child takes only when switched on for them (student_service). */
export const OPTIONAL_ITEMS = ["transport", "service"] as const;
export type OptionalItem = (typeof OPTIONAL_ITEMS)[number];

/** Spec P1: cash, card (POS), bank transfer, InstaPay, mobile wallet. */
export const PAYMENT_METHODS = ["cash", "card", "bank_transfer", "instapay", "wallet"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const INVOICE_KINDS = ["tuition", "late_fee", "other"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/** "2026-11-17" → "2026-11-01". */
export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Last day of the month of `iso`. */
export function monthEnd(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** First day of the month `n` months after the month of `iso`. */
export function shiftMonth(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/** Every date of the month of `iso`. */
export function daysOfMonth(iso: string): string[] {
  const start = monthStart(iso);
  const last = Number(monthEnd(iso).slice(8));
  return Array.from({ length: last }, (_, i) => `${start.slice(0, 8)}${String(i + 1).padStart(2, "0")}`);
}

/** Due date of a month's invoice (D4: the 5th), clamped to the month. */
export function dueDateFor(month: string, dueDay: number): string {
  const last = Number(monthEnd(month).slice(8));
  return `${month.slice(0, 8)}${String(Math.min(Math.max(dueDay, 1), last)).padStart(2, "0")}`;
}

/** a × num ÷ den, rounded half up, in whole piastres. */
export function prorate(amount: bigint, num: number, den: number): bigint {
  if (den <= 0) return 0n;
  if (num >= den) return amount;
  const n = BigInt(num);
  const d = BigInt(den);
  return (amount * n * 2n + d) / (2n * d);
}

export interface FeeItem {
  itemType: ItemType;
  /** null = every age band. */
  ageBandId: string | null;
  amount: bigint;
}

export interface DatedPrice {
  itemType: ItemType;
  amount: bigint;
  startsOn: string;
  endsOn: string | null;
}

export interface Discount {
  name: string;
  type: "percent" | "amount";
  /** Percent in basis points (1000 = 10%), amount in piastres. */
  value: bigint;
  appliesTo: ItemType;
  startsOn: string;
  endsOn: string | null;
}

export interface ChildForBilling {
  /** The age band of the child's class. */
  ageBandId: string;
  /** Enrollment start date. */
  startDate: string;
  priceLocks: DatedPrice[];
  services: { itemType: OptionalItem; startsOn: string; endsOn: string | null }[];
  /** A tuition invoice already exists for an earlier month (registration is charged once). */
  billedBefore: boolean;
}

export interface Line {
  itemType: ItemType;
  /** "" for a full month; "12/22" when pro-rated by working days; the rule's name for a discount. */
  description: string;
  unit: bigint;
  amount: bigint;
  source: "fee_list" | "price_lock" | "discount";
}

export type LinesResult = { lines: Line[]; total: bigint; prorated: boolean } | { error: "no_fee" | "not_started" };

const activeOn = (d: string, r: { startsOn: string; endsOn: string | null }) => r.startsOn <= d && (r.endsOn === null || r.endsOn >= d);

/** The fee for an item: exact age band first, then a fee for every band. */
function feeFor(items: readonly FeeItem[], itemType: ItemType, ageBandId: string): bigint | null {
  const exact = items.find((i) => i.itemType === itemType && i.ageBandId === ageBandId);
  const any = items.find((i) => i.itemType === itemType && i.ageBandId === null);
  return (exact ?? any)?.amount ?? null;
}

/**
 * Lines of one child's tuition invoice for `month` (spec §8.4.1):
 * a price lock in force wins over the fee list; children starting after the 1st pay for the working days
 * from their start (when `prorateNewStarts`); registration is charged once; discounts in force come off.
 * `workingDays` are the month's working days for the branch.
 */
export function invoiceLines(
  child: ChildForBilling,
  fees: readonly FeeItem[],
  discounts: readonly Discount[],
  month: string,
  workingDays: readonly string[],
  prorateNewStarts: boolean,
): LinesResult {
  const first = monthStart(month);
  const last = monthEnd(month);
  if (child.startDate > last) return { error: "not_started" };
  const billedFrom = child.startDate > first ? child.startDate : first;
  const fromDays = workingDays.filter((d) => d >= billedFrom).length;
  const partial = prorateNewStarts && billedFrom > first && fromDays < workingDays.length;

  const priced = (itemType: ItemType): { unit: bigint; source: Line["source"] } | null => {
    const lock = child.priceLocks.find((p) => p.itemType === itemType && activeOn(billedFrom, p));
    if (lock) return { unit: lock.amount, source: "price_lock" };
    const fee = feeFor(fees, itemType, child.ageBandId);
    return fee === null ? null : { unit: fee, source: "fee_list" };
  };

  const lines: Line[] = [];
  const monthly = (itemType: ItemType) => {
    const p = priced(itemType);
    if (!p) return false;
    const amount = partial ? prorate(p.unit, fromDays, workingDays.length) : p.unit;
    lines.push({ itemType, description: partial ? `${fromDays}/${workingDays.length}` : "", unit: p.unit, amount, source: p.source });
    return true;
  };

  if (!monthly("tuition")) return { error: "no_fee" };
  for (const s of child.services) {
    if (s.startsOn <= last && (s.endsOn === null || s.endsOn >= billedFrom)) monthly(s.itemType);
  }
  if (!child.billedBefore) {
    const p = priced("registration");
    if (p && p.unit > 0n) lines.push({ itemType: "registration", description: "", unit: p.unit, amount: p.unit, source: p.source });
  }

  for (const d of discounts) {
    if (!activeOn(billedFrom, d)) continue;
    for (const line of lines.filter((l) => l.itemType === d.appliesTo && l.source !== "discount")) {
      const off = d.type === "percent" ? prorate(line.amount, Number(d.value), 10000) : d.value < line.amount ? d.value : line.amount;
      if (off > 0n) lines.push({ itemType: line.itemType, description: d.name, unit: -off, amount: -off, source: "discount" });
    }
  }

  const total = lines.reduce((s, l) => s + l.amount, 0n);
  return { lines, total, prorated: partial };
}

export interface OpenInvoice {
  id: string;
  kind: InvoiceKind;
  dueDate: string;
  balance: bigint;
}

const KIND_ORDER: Record<InvoiceKind, number> = { tuition: 0, other: 1, late_fee: 2 };

/**
 * Default allocation (spec §8.4.3): oldest open tuition first, then other invoices, then late fees.
 * Whatever is left stays on the family's account as credit.
 */
export function allocate(amount: bigint, invoices: readonly OpenInvoice[]): { allocations: { invoiceId: string; amount: bigint }[]; credit: bigint } {
  const order = [...invoices]
    .filter((i) => i.balance > 0n)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  let left = amount;
  const allocations: { invoiceId: string; amount: bigint }[] = [];
  for (const inv of order) {
    if (left <= 0n) break;
    const take = inv.balance < left ? inv.balance : left;
    allocations.push({ invoiceId: inv.id, amount: take });
    left -= take;
  }
  return { allocations, credit: left };
}

/** Spec §8.5: opening float + cash in − cash out − handed over − counted. Positive = cash missing. */
export function cashVariance(v: { opening: bigint; cashIn: bigint; cashOut: bigint; handedOver: bigint; counted: bigint }): bigint {
  return v.opening + v.cashIn - v.cashOut - v.handedOver - v.counted;
}

/** The cash a box should hold before anything is handed over. */
export function expectedCash(v: { opening: bigint; cashIn: bigint; cashOut: bigint }): bigint {
  return v.opening + v.cashIn - v.cashOut;
}

export const AGE_BUCKETS = ["d1_30", "d31_60", "d60_plus"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/** Days past the due date (0 when not yet due). */
export function daysOverdue(dueDate: string, today: string): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** Spec §9.1 overdue ageing: 1–30, 31–60, 60+ days. */
export function ageBucket(days: number): AgeBucket | null {
  if (days <= 0) return null;
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  return "d60_plus";
}

export const balanceOf = (i: { totalPiastres: bigint; paidPiastres: bigint; creditedPiastres: bigint }) =>
  i.totalPiastres - i.paidPiastres - i.creditedPiastres;

/** "12/22" → [12, 22] for a pro-rated line; null otherwise. */
export function proratedDays(description: string): [number, number] | null {
  const m = /^(\d+)\/(\d+)$/.exec(description);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
