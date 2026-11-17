"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";
import { withUserDb, dbErrorCode } from "@/db/rls";
import { appUser, authAccount, authSession, authTwoFactor, userBranchRole } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { requireSettings } from "@/lib/require-user";
import { isOwner } from "@/lib/permissions";
import { grantKey, parseGrants, temporaryPassword } from "./grants";

const loc = (fd: FormData) => z.enum(["ar", "en"]).catch("ar").parse(fd.get("locale"));

const details = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((v) => v || null),
  locale: z.enum(["ar", "en"]),
});

export type CreateUserState = { status: "idle" } | { status: "ok"; userId: string; password: string } | { status: "error"; code: string };

/** Creates a staff account with a temporary password (returned once, never put in a URL). */
export async function createUser(_prev: CreateUserState, fd: FormData): Promise<CreateUserState> {
  const user = await requireSettings(loc(fd));
  try {
    const d = details.extend({ email: z.email().transform((e) => e.toLowerCase()) }).parse({
      name: fd.get("name"),
      email: fd.get("email"),
      phone: fd.get("phone") ?? "",
      locale: fd.get("userLocale"),
    });
    const grants = parseGrants(fd.getAll("grant"));
    if (grants.some((g) => g.role === "owner") && !isOwner(user)) return { status: "error", code: "forbidden" };
    const password = temporaryPassword();
    const hash = await hashPassword(password);
    const userId = await withUserDb(user.id, async (tx) => {
      const [u] = await tx
        .insert(appUser)
        .values({ name: d.name, email: d.email, phone: d.phone, locale: d.locale, emailVerified: true })
        .returning({ id: appUser.id });
      await tx.insert(authAccount).values({ userId: u.id, accountId: u.id, providerId: "credential", password: hash });
      if (grants.length) await tx.insert(userBranchRole).values(grants.map((g) => ({ ...g, userId: u.id })));
      return u.id;
    });
    return { status: "ok", userId, password };
  } catch (e) {
    return { status: "error", code: e instanceof z.ZodError ? "invalid" : dbErrorCode(e) };
  }
}

export async function updateUser(fd: FormData) {
  const locale = loc(fd);
  const user = await requireSettings(locale);
  const id = z.uuid().parse(fd.get("id"));
  await runAndReturn(locale, `/settings/users/${id}`, async () => {
    const d = details
      .extend({ endDate: z.string().trim().transform((v) => v || null).pipe(z.iso.date().nullable()) })
      .parse({ name: fd.get("name"), phone: fd.get("phone") ?? "", locale: fd.get("userLocale"), endDate: fd.get("endDate") ?? "" });
    const wanted = parseGrants(fd.getAll("grant"));
    const isSelf = id === user.id;

    await withUserDb(user.id, async (tx) => {
      await tx.update(appUser).set({ name: d.name, phone: d.phone, locale: d.locale, endDate: isSelf ? undefined : d.endDate, updatedAt: new Date() }).where(eq(appUser.id, id));
      if (isSelf) return; // Nobody edits their own roles (also enforced by the database).
      const current = await tx.select().from(userBranchRole).where(eq(userBranchRole.userId, id));
      const wantedKeys = new Set(wanted.map(grantKey));
      const currentKeys = new Set(current.map((c) => grantKey({ role: c.role, branchId: c.branchId })));
      for (const c of current) {
        if (!wantedKeys.has(grantKey({ role: c.role, branchId: c.branchId }))) {
          const del = await tx.delete(userBranchRole).where(eq(userBranchRole.id, c.id)).returning({ id: userBranchRole.id });
          if (del.length === 0) throw Object.assign(new Error("not allowed"), { code: "42501" });
        }
      }
      const toAdd = wanted.filter((g) => !currentKeys.has(grantKey(g)));
      if (toAdd.length) await tx.insert(userBranchRole).values(toAdd.map((g) => ({ ...g, userId: id })));
      if (d.endDate) await tx.delete(authSession).where(eq(authSession.userId, id));
    });
  });
}

export type ResetPasswordState = { status: "idle" } | { status: "ok"; password: string } | { status: "error"; code: string };

/** New temporary password; signs the person out everywhere. */
export async function resetPassword(_prev: ResetPasswordState, fd: FormData): Promise<ResetPasswordState> {
  const user = await requireSettings(loc(fd));
  try {
    const id = z.uuid().parse(fd.get("id"));
    if (id === user.id) return { status: "error", code: "self" };
    const password = temporaryPassword();
    const hash = await hashPassword(password);
    await withUserDb(
      user.id,
      async (tx) => {
        await tx.update(authAccount).set({ password: hash, updatedAt: new Date() }).where(and(eq(authAccount.userId, id), eq(authAccount.providerId, "credential")));
        await tx.delete(authSession).where(eq(authSession.userId, id));
        // Recorded on the user row so the reset appears in the audit log (the password itself never is).
        await tx.update(appUser).set({ credentialsResetAt: new Date(), updatedAt: new Date() }).where(eq(appUser.id, id));
      },
      { reason: "password reset by manager" },
    );
    return { status: "ok", password };
  } catch (e) {
    return { status: "error", code: dbErrorCode(e) };
  }
}

/** For a lost phone: turns two-step sign-in off; privileged roles must set it up again at next sign-in. */
export async function resetMfa(fd: FormData) {
  const locale = loc(fd);
  const user = await requireSettings(locale);
  const id = z.uuid().parse(fd.get("id"));
  await runAndReturn(locale, `/settings/users/${id}`, async () => {
    if (id === user.id) return { error: "self" };
    await withUserDb(
      user.id,
      async (tx) => {
        await tx.delete(authTwoFactor).where(eq(authTwoFactor.userId, id));
        await tx.update(appUser).set({ twoFactorEnabled: false, updatedAt: new Date() }).where(eq(appUser.id, id));
        await tx.delete(authSession).where(eq(authSession.userId, id));
      },
      { reason: "two-step sign-in reset by manager" },
    );
  });
}
