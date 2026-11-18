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

type RoleName = CurrentUser["grants"][number]["role"];

/** Holds one of these roles in this branch, or organization-wide. Mirrors app_has_role_in() in the database. */
export function hasRoleIn(user: U, roles: readonly RoleName[], branchId: string): boolean {
  return user.grants.some((g) => roles.includes(g.role) && (g.branchId === null || g.branchId === branchId));
}

function hasAnyRole(user: U, roles: readonly RoleName[]): boolean {
  return user.grants.some((g) => roles.includes(g.role));
}

/** Spec §5 "Children": who opens the children screens. Teachers see only their rooms (row-level security). */
export const CHILD_VIEW_ROLES = ["owner", "company_manager", "branch_manager", "front_desk", "accountant", "teacher"] as const;
export const CHILD_EDIT_ROLES = ["branch_manager", "front_desk"] as const;

export function canViewChildren(user: U): boolean {
  return hasAnyRole(user, CHILD_VIEW_ROLES);
}

export function canEditChildren(user: U, branchId?: string): boolean {
  return branchId ? hasRoleIn(user, CHILD_EDIT_ROLES, branchId) : hasAnyRole(user, CHILD_EDIT_ROLES);
}

/** Spreadsheet imports of children and their rollback (spec §8.11): company manager. */
export function canImportChildren(user: U): boolean {
  return hasAnyRole(user, ["company_manager"]);
}

/** Medical notes: branch manager of that branch (teachers read them from their room screens). */
export function canEditMedical(user: U, branchId: string): boolean {
  return hasRoleIn(user, ["branch_manager"], branchId);
}

/** Owner and company manager may read medical notes only by giving a reason ("break-glass", spec §5). */
export function canBreakGlass(user: U, branchId: string): boolean {
  return hasRoleIn(user, ["owner", "company_manager"], branchId);
}

/** Waitlist: managers and front desk (spec §8.1). */
export function canViewWaitlist(user: U): boolean {
  return hasAnyRole(user, ["owner", "company_manager", "branch_manager", "front_desk"]);
}

/** Approvals inbox for children: owner (over capacity), branch managers (incoming transfers), and whoever asked. */
export function canSeeChildApprovals(user: U): boolean {
  return hasAnyRole(user, ["owner", "company_manager", "branch_manager", "front_desk"]);
}
