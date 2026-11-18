import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { db } from "@/db";
import { appUser, deviceLogin, userBranchRole } from "@/db/schema";
import { DEVICE_COOKIE, MAX_PIN_ATTEMPTS, SHARED_IDLE_MINUTES, readDeviceTokens, tokenHash, verifyPin } from "./pin";
import { isRole, requiresMfa } from "./roles";

/**
 * Quick sign-in with a PIN on a shared class phone (spec §7.2 pin_hash, §14). Only for people who
 * set it up on this phone (its cookie holds their token) and who do not need two-step sign-in.
 * The session it creates is marked shared and ends after 30 minutes without use.
 */
export function pinLogin() {
  return {
    id: "pin-login",
    endpoints: {
      pinSignIn: createAuthEndpoint(
        "/pin/sign-in",
        { method: "POST", body: z.object({ loginId: z.uuid(), pin: z.string().max(12) }) },
        async (ctx) => {
          const hashes = readDeviceTokens(ctx.getCookie(DEVICE_COOKIE)).map(tokenHash);
          if (!hashes.length) throw new APIError("UNAUTHORIZED", { message: "not_set_up" });
          const [login] = await db
            .select({ id: deviceLogin.id, userId: deviceLogin.userId, failed: deviceLogin.failedAttempts, pinHash: appUser.pinHash, endDate: appUser.endDate })
            .from(deviceLogin)
            .innerJoin(appUser, eq(appUser.id, deviceLogin.userId))
            .where(and(eq(deviceLogin.id, ctx.body.loginId), inArray(deviceLogin.tokenHash, hashes), isNull(deviceLogin.revokedAt)));
          if (!login) throw new APIError("UNAUTHORIZED", { message: "not_set_up" });
          if (login.endDate && new Date(login.endDate).getTime() <= Date.now()) throw new APIError("UNAUTHORIZED", { message: "ended" });

          const roles = (await db.select({ role: userBranchRole.role }).from(userBranchRole).where(eq(userBranchRole.userId, login.userId)))
            .map((r) => r.role)
            .filter(isRole);
          if (requiresMfa(roles)) throw new APIError("FORBIDDEN", { message: "needs_mfa" });

          if (!(await verifyPin(ctx.body.pin, login.pinHash))) {
            const failed = login.failed + 1;
            await db
              .update(deviceLogin)
              .set({ failedAttempts: failed, revokedAt: failed >= MAX_PIN_ATTEMPTS ? new Date() : null })
              .where(eq(deviceLogin.id, login.id));
            throw new APIError("UNAUTHORIZED", { message: failed >= MAX_PIN_ATTEMPTS ? "locked" : "wrong_pin" });
          }
          await db.update(deviceLogin).set({ failedAttempts: 0, lastUsedAt: new Date() }).where(eq(deviceLogin.id, login.id));

          const user = await ctx.context.internalAdapter.findUserById(login.userId);
          if (!user) throw new APIError("UNAUTHORIZED", { message: "not_set_up" });
          const now = new Date();
          const session = await ctx.context.internalAdapter.createSession(
            login.userId,
            true,
            { expiresAt: new Date(now.getTime() + 12 * 3600_000), sharedDevice: true, lastActiveAt: now },
            true,
          );
          // A browser-session cookie; the server ends the session after 30 idle minutes (src/lib/session.ts).
          await setSessionCookie(ctx, { session, user }, true);
          return ctx.json({ ok: true, idleMinutes: SHARED_IDLE_MINUTES });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
