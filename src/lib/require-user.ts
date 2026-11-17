import "server-only";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { canOpenSection, type Role, type Section } from "./roles";
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
