import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { userBranchRole } from "@/db/schema";
import { withUserDb } from "@/db/rls";
import { auth } from "./auth";
import { isRole, primaryRole, requiresMfa, type Role } from "./roles";

export const ACTIVE_ROLE_COOKIE = "yanmu_active_role";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  locale: "ar" | "en";
  digits: "arabic" | "latin";
  mfaEnabled: boolean;
  roles: Role[];
  /** Each role with its branch (null = all branches). */
  grants: { role: Role; branchId: string | null }[];
  activeRole: Role | null;
  mustSetUpMfa: boolean;
}

/** Reads the session and roles from the database. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user;

  // Spec §5: access ends at 00:00 on the user's end date.
  const endDate = u.endDate ? new Date(u.endDate) : null;
  if (endDate && endDate.getTime() <= Date.now()) return null;

  const grants = await withUserDb(u.id, (tx) =>
    tx
      .select({ role: userBranchRole.role, branchId: userBranchRole.branchId })
      .from(userBranchRole)
      .where(eq(userBranchRole.userId, u.id)),
  );
  const roles = Array.from(new Set(grants.map((r) => r.role)));

  const cookieRole = (await cookies()).get(ACTIVE_ROLE_COOKIE)?.value;
  const activeRole = isRole(cookieRole) && roles.includes(cookieRole) ? cookieRole : primaryRole(roles);
  const mfaEnabled = Boolean(u.twoFactorEnabled);

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    locale: u.locale === "en" ? "en" : "ar",
    digits: u.digits === "arabic" ? "arabic" : "latin",
    mfaEnabled,
    roles,
    grants,
    activeRole,
    mustSetUpMfa: requiresMfa(roles) && !mfaEnabled,
  };
});
