import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./index";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` in one transaction as this person (spec §13.1).
 * Sets `app.user_id` with SET LOCAL semantics, so row-level security policies decide
 * which branches and rows are visible, and the audit trigger records who acted.
 * `reason` is stored on every audit row the transaction writes (e.g. break-glass, waivers).
 */
export async function withUserDb<T>(userId: string, fn: (tx: Tx) => Promise<T>, opts: { reason?: string } = {}): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.user_id', ${userId}, true), set_config('app.audit_reason', ${opts.reason ?? ""}, true)`,
    );
    return fn(tx);
  });
}

/** Friendly classification of database errors raised by policies and constraints. */
export function dbErrorCode(error: unknown): "forbidden" | "duplicate" | "invalid" | "unknown" {
  const code = findPgCode(error);
  if (code === "42501") return "forbidden"; // insufficient_privilege / RLS violation
  if (code === "23505") return "duplicate";
  if (code && /^2[23]/.test(code)) return "invalid";
  return "unknown";
}

function findPgCode(error: unknown): string | undefined {
  let e: unknown = error;
  for (let i = 0; i < 5 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
