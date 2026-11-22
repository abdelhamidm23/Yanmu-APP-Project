import "server-only";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { canOpenSection, type Role, type Section } from "./roles";
import {
  canImportChildren,
  canImportPunches,
  canOpenSettings,
  canOpenToday,
  canSeeChildApprovals,
  canTakeAttendance,
  canViewChildren,
  canViewStaff,
  canViewStaffAttendance,
  canViewWaitlist,
  isOrgAdmin,
  canViewMoney,
  canRecordPayment,
  canRunInvoices,
  canDecideMoney,
  canRequestCredit,
  canViewExpenses,
  canRecordExpense,
  canUseCashBox,
  canReconcileCash,
  canEditFees,
} from "./permissions";
import { getCurrentUser, type CurrentUser } from "./session";

/**
 * Server-side gate for every signed-in screen:
 * no session → sign in; privileged role without MFA → MFA setup.
 */
export async function requireUser(locale: string): Promise<CurrentUser & { activeRole: Role | null }> {
  const user = await getCurrentUser();
  if (!user) redirect({ href: "/login", locale });
  if (user!.mustSetUpMfa) redirect({ href: "/setup-mfa", locale });
  return user!;
}

/** Same, plus the active role must have this section in its navigation (spec §11.1). Otherwise 404. */
export async function requireSection(locale: string, section: Section | string): Promise<CurrentUser & { activeRole: Role }> {
  const user = await requireUser(locale);
  if (section === "more") return user as CurrentUser & { activeRole: Role };
  if (!user.activeRole || !canOpenSection(user.activeRole, section)) notFound();
  return user as CurrentUser & { activeRole: Role };
}

/** Settings screens. "admin" = owner or company manager; "calendar" also lets branch managers in. */
export async function requireSettings(locale: string, level: "admin" | "calendar" = "admin"): Promise<CurrentUser> {
  const user = await requireUser(locale);
  const allowed = level === "admin" ? isOrgAdmin(user) : canOpenSettings(user);
  if (!allowed) notFound();
  return user;
}

/** Children screens (spec §5, §8.1). The database's row-level security narrows what each role sees. */
export async function requireChildren(
  locale: string,
  area: "view" | "waitlist" | "approvals" | "import" = "view",
): Promise<CurrentUser & { activeRole: Role | null }> {
  const user = await requireUser(locale);
  const allowed =
    area === "view" ? canViewChildren(user)
    : area === "waitlist" ? canViewWaitlist(user)
    : area === "approvals" ? canSeeChildApprovals(user)
    : canImportChildren(user);
  if (!allowed) notFound();
  return user;
}

/** Attendance, roster and staff screens (spec §5, §8.2, §8.3). Row-level security narrows the rows. */
export async function requireArea(
  locale: string,
  area: "attendance" | "today" | "staff" | "staff-attendance" | "punch-import",
): Promise<CurrentUser & { activeRole: Role | null }> {
  const user = await requireUser(locale);
  const allowed =
    area === "attendance" ? canTakeAttendance(user)
    : area === "today" ? canOpenToday(user)
    : area === "staff" ? canViewStaff(user)
    : area === "staff-attendance" ? canViewStaffAttendance(user)
    : canImportPunches(user);
  if (!allowed) notFound();
  return user;
}

/** Money screens (spec §5, Phase 4). Row-level security narrows the branches and rows. */
export async function requireMoney(
  locale: string,
  area: "view" | "payment" | "run" | "inbox" | "expenses" | "expense-new" | "cash" | "fees",
): Promise<CurrentUser & { activeRole: Role | null }> {
  const user = await requireUser(locale);
  const allowed =
    area === "view" ? canViewMoney(user)
    : area === "payment" ? canRecordPayment(user)
    : area === "run" ? canRunInvoices(user)
    : area === "inbox" ? canDecideMoney(user) || canRequestCredit(user) || canRecordExpense(user)
    : area === "expenses" ? canViewExpenses(user)
    : area === "expense-new" ? canRecordExpense(user)
    : area === "cash" ? canUseCashBox(user) || canReconcileCash(user) || canDecideMoney(user)
    : canEditFees(user);
  if (!allowed) notFound();
  return user;
}
