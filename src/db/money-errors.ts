import "server-only";
import { dbRuleCode } from "./rls";

/** Refusals raised by the money rules in the database (drizzle/0009), as codes the screens explain. */
export const MONEY_ERRORS = [
  "too_much",
  "waiver_late_fee_only",
  "reason_required",
  "not_pending",
  "own_request",
  "owner_decides",
  "cash_box_not_open",
  "receipt_required",
  "request_not_needed",
  "already_closed",
  "not_today",
  "over_allocated",
  "not_closed",
] as const;

export function moneyError(e: unknown): { error: string } | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const msg = (cur as { message?: unknown }).message;
    const hit = MONEY_ERRORS.find((k) => msg === k);
    if (hit) return { error: hit };
    if (msg === "invalid date") return { error: "invalid_date" };
    cur = (cur as { cause?: unknown }).cause;
  }
  const rule = dbRuleCode(e);
  return rule ? { error: rule } : null;
}

/** Runs money work and turns a known database refusal into { error }. */
export async function withMoneyErrors<T>(work: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await work();
  } catch (e) {
    const known = moneyError(e);
    if (known) return known;
    throw e;
  }
}
