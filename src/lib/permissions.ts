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

/** Spec §5 "Child attendance, pickup": branch manager and front desk (own branch), teachers (own room). */
export const ATTENDANCE_EDIT_ROLES = ["branch_manager", "front_desk"] as const;

export function canTakeAttendance(user: U, branchId?: string): boolean {
  return branchId ? hasRoleIn(user, ATTENDANCE_EDIT_ROLES, branchId) : hasAnyRole(user, [...ATTENDANCE_EDIT_ROLES, "teacher"]);
}

/** Branch "Today" screen (spec §11.6): branch manager and front desk. */
export function canOpenToday(user: U): boolean {
  return hasAnyRole(user, ATTENDANCE_EDIT_ROLES);
}

/** Spec §5 "Staff records": HR edits; owner, company manager, branch manager (own) and accountant view. */
export const STAFF_VIEW_ROLES = ["owner", "company_manager", "branch_manager", "accountant", "hr"] as const;

export function canViewStaff(user: U): boolean {
  return hasAnyRole(user, STAFF_VIEW_ROLES);
}

export function canEditStaff(user: U, branchId?: string): boolean {
  return branchId ? hasRoleIn(user, ["hr"], branchId) : hasAnyRole(user, ["hr"]);
}

/** Fingerprint file uploads and linking device numbers: branch manager (own) and HR (spec §5 Imports). */
export function canImportPunches(user: U, branchId?: string): boolean {
  return branchId ? hasRoleIn(user, ["branch_manager", "hr"], branchId) : hasAnyRole(user, ["branch_manager", "hr"]);
}

/** Daily room roster and the "present" tap: branch manager (spec §8.3). */
export function canEditRoster(user: U, branchId: string): boolean {
  return hasRoleIn(user, ["branch_manager"], branchId);
}

/** Staff attendance days and ratios: who reads them. */
export function canViewStaffAttendance(user: U): boolean {
  return hasAnyRole(user, ["owner", "company_manager", "branch_manager", "hr"]);
}

/**
 * Money (spec §5, Phase 4). The database enforces the same rules (drizzle/0009_phase4_money_rls.sql).
 *   view: owner, company manager, branch manager, accountant, front desk
 *   payments: front desk, branch manager, accountant · invoice run: accountant
 *   credit notes: accountant creates, branch manager requests · decisions: owner, company manager
 *   expenses: owner, company manager, branch manager, accountant view; branch manager and accountant record
 *   cash box: front desk and branch manager; accountant reconciles
 */
export const FINANCE_VIEW_ROLES = ["owner", "company_manager", "branch_manager", "accountant", "front_desk"] as const;
export const PAYMENT_ROLES = ["front_desk", "branch_manager", "accountant"] as const;
export const EXPENSE_VIEW_ROLES = ["owner", "company_manager", "branch_manager", "accountant"] as const;
export const EXPENSE_ROLES = ["branch_manager", "accountant"] as const;
export const CASH_ROLES = ["front_desk", "branch_manager"] as const;
export const DECIDER_ROLES = ["owner", "company_manager"] as const;
export const CREDIT_ROLES = ["accountant", "branch_manager"] as const;
export const VOID_ROLES = ["branch_manager", "accountant", "company_manager"] as const;

const roleCheck = (roles: readonly RoleName[]) => (user: U, branchId?: string) =>
  branchId ? hasRoleIn(user, roles, branchId) : hasAnyRole(user, roles);

export const canViewMoney = roleCheck(FINANCE_VIEW_ROLES);
export const canRecordPayment = roleCheck(PAYMENT_ROLES);
export const canRunInvoices = roleCheck(["accountant"]);
export const canRequestCredit = roleCheck(CREDIT_ROLES);
export const canDecideMoney = roleCheck(DECIDER_ROLES);
export const canViewExpenses = roleCheck(EXPENSE_VIEW_ROLES);
export const canRecordExpense = roleCheck(EXPENSE_ROLES);
export const canUseCashBox = roleCheck(CASH_ROLES);
export const canReconcileCash = roleCheck(["accountant"]);
export const canVoidPayment = roleCheck(VOID_ROLES);
/** Fee lists, discounts, legacy prices and routine expense lists (settings, spec §11.8). */
export const canEditFees = roleCheck(DECIDER_ROLES);

/**
 * Whether a money approval waits for this person now (spec §8.6): never their own request; the owner
 * decides anything; the company manager decides up to the limit and recommends above it.
 */
export function myTurnToDecide(
  user: U & { id: string },
  r: { branchId: string; status: string; requestedBy: string | null; stepCount: number; currentStep: number },
): "decide" | "recommend" | null {
  if (r.status !== "pending" || r.requestedBy === user.id) return null;
  if (hasRoleIn(user, ["owner"], r.branchId)) return "decide";
  if (hasRoleIn(user, ["company_manager"], r.branchId)) {
    if (r.stepCount === 1) return "decide";
    if (r.currentStep === 1) return "recommend";
  }
  return null;
}
