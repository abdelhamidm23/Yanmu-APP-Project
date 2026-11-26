import "server-only";
import { dbRuleCode } from "./rls";

/** Refusals raised by the closing rules in the database (drizzle/0015), as codes the screens explain. */
export const CLOSING_ERRORS = [
  "section_missing",
  "fix_note_required",
  "not_pending",
  "month_not_over",
  "template_required",
  "difference_note_required",
  "reason_required",
  "own_request",
  "month_closed",
] as const;

export async function withClosingErrors<T>(work: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await work();
  } catch (e) {
    let cur: unknown = e;
    for (let i = 0; i < 5 && cur; i++) {
      const msg = (cur as { message?: unknown }).message;
      const hit = CLOSING_ERRORS.find((k) => msg === k);
      if (hit) return { error: hit };
      if (msg === "invalid date") return { error: "invalid_date" };
      if ((cur as { code?: unknown }).code === "23505") return { error: "already_closed" };
      cur = (cur as { cause?: unknown }).cause;
    }
    const rule = dbRuleCode(e);
    if (rule) return { error: rule };
    throw e;
  }
}
