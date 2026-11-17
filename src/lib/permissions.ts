/**
 * Server-side permission checks (spec §5). The database enforces the same rules with
 * row-level security; these exist so screens refuse early and show the right things.
 */
import type { CurrentUser } from "./session";

type U = Pick<CurrentUser, "grants">;

/** Owner or company manager across the organization: full settings (spec §5 "Users, roles, settings"). */
export function isOrgAdmin(user: U): boolean {
  return user.grants.some((g) => g.branchId === null && (g.role === "owner" || g.role === "company_manager"));
}

export function isOwner(user: U): boolean {
  return user.grants.some((g) => g.branchId === null && g.role === "owner");
}

/** Holidays: company manager / owner, or a branch manager for their own branch (spec W1). */
export function canEditHolidays(user: U): boolean {
  return isOrgAdmin(user) || user.grants.some((g) => g.role === "branch_manager");
}

export function canOpenSettings(user: U): boolean {
  return canEditHolidays(user);
}

/** Organization-wide roles may be granted for all branches; the rest need a branch. */
export const ORG_WIDE_ALLOWED = ["owner", "company_manager", "accountant", "hr"] as const;
