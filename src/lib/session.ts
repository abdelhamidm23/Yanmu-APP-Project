import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { authSession, userBranchRole } from "@/db/schema";
import { db } from "@/db";
import { SHARED_IDLE_MINUTES } from "./pin";
import { withUserDb } from "@/db/rls";
import { auth } from "./auth";
import { isRole, primaryRole, requiresMfa, type Role } from "./roles";
import { isDemoMode } from "./demo";

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
  /** Signed in with a PIN on a shared class phone. */
  sharedDevice: boolean;
}

/** Reads the session and roles from the database. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user;

  // Spec §14: a PIN sign-in on a shared class phone ends after 30 minutes without use.
  const s = session.session as typeof session.session & { sharedDevice?: boolean | null; lastActiveAt?: Date | string | null };
  if (s.sharedDevice) {
    const last = s.lastActiveAt ? new Date(s.lastActiveAt).getTime() : 0;
    if (Date.now() - last > SHARED_IDLE_MINUTES * 60_000) {
      await db.delete(authSession).where(eq(authSession.token, s.token));
      return null;
    }
    if (Date.now() - last > 60_000) await db.update(authSession).set({ lastActiveAt: new Date() }).where(eq(authSession.token, s.token));
  }

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
    // In the online demo, two-step sign-in is offered (More → Security) but not forced,
    // so anyone trying the preview can open every role without an authenticator app.
    mustSetUpMfa: requiresMfa(roles) && !mfaEnabled && !isDemoMode(),
    sharedDevice: Boolean(s.sharedDevice),
  };
});
