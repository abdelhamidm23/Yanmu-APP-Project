import "server-only";

/** Refusals raised by the safety rules in the database (drizzle/0013), as codes the screens explain. */
export const SAFETY_ERRORS = [
  "report_required",
  "guardian_required",
  "not_pending",
  "review_required",
  "owner_decides",
  "severity_down",
  "already_closed",
  "assignee_not_in_branch",
] as const;

export function safetyError(e: unknown): { error: string } | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const msg = (cur as { message?: unknown }).message;
    const hit = SAFETY_ERRORS.find((k) => msg === k);
    if (hit) return { error: hit };
    if (msg === "invalid date") return { error: "invalid_date" };
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

export async function withSafetyErrors<T>(work: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await work();
  } catch (e) {
    const known = safetyError(e);
    if (known) return known;
    throw e;
  }
}
