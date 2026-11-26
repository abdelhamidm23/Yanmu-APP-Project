"use server";
import { cookies } from "next/headers";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appUser, deviceLogin } from "@/db/schema";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser, ACTIVE_ROLE_COOKIE } from "@/lib/session";
import { homeSection, requiresMfa, ROLES } from "@/lib/roles";
import { DEVICE_COOKIE, PIN_PATTERN, deviceCookieOptions, hashPin, newDeviceToken, readDeviceTokens, tokenHash, writeDeviceTokens } from "@/lib/pin";

const prefsSchema = z.object({
  locale: z.enum(["ar", "en"]),
  digits: z.enum(["arabic", "latin"]),
});

/** Saves language and digit preference, then reopens More in the chosen language. */
export async function savePreferences(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale: "ar" });
  const prefs = prefsSchema.parse({ locale: formData.get("locale"), digits: formData.get("digits") });
  await db.update(appUser).set({ locale: prefs.locale, digits: prefs.digits, updatedAt: new Date() }).where(eq(appUser.id, user.id));
  (await cookies()).set("NEXT_LOCALE", prefs.locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return redirect({ href: "/more/account?saved=1", locale: prefs.locale });
}

/** Switches the active role. Only roles the person actually holds are accepted. */
export async function switchRole(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale: "ar" });
  const role = z.enum(ROLES).parse(formData.get("role"));
  const locale = z.enum(["ar", "en"]).catch("ar").parse(formData.get("locale"));
  if (!user.roles.includes(role)) throw new Error("Role not held by this user");
  (await cookies()).set(ACTIVE_ROLE_COOKIE, role, { path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  return redirect({ href: `/${homeSection(role)}`, locale });
}

/**
 * Quick sign-in on a shared class phone (spec §14): saves this person's PIN and remembers them on
 * this phone only. People who need two-step sign-in cannot use a PIN.
 */
export async function setUpPin(formData: FormData) {
  const locale = z.enum(["ar", "en"]).catch("ar").parse(formData.get("locale"));
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });
  const pin = String(formData.get("pin") ?? "");
  const again = String(formData.get("pinAgain") ?? "");
  if (requiresMfa(user.roles)) return redirect({ href: "/more/account?pin=needsMfa", locale });
  if (!PIN_PATTERN.test(pin) || /^(\d)\1+$/.test(pin) || "0123456789".includes(pin)) return redirect({ href: "/more/account?pin=weak", locale });
  if (pin !== again) return redirect({ href: "/more/account?pin=mismatch", locale });

  const jar = await cookies();
  const tokens = readDeviceTokens(jar.get(DEVICE_COOKIE)?.value);
  const hashes = tokens.map(tokenHash);
  // One entry per person per phone: replace this person's old one.
  if (hashes.length) await db.delete(deviceLogin).where(and(eq(deviceLogin.userId, user.id), inArray(deviceLogin.tokenHash, hashes)));
  const token = newDeviceToken();
  await db.update(appUser).set({ pinHash: await hashPin(pin), updatedAt: new Date() }).where(eq(appUser.id, user.id));
  await db.insert(deviceLogin).values({ userId: user.id, tokenHash: tokenHash(token) });
  const kept = (
    await db
      .select({ hash: deviceLogin.tokenHash })
      .from(deviceLogin)
      .where(and(inArray(deviceLogin.tokenHash, hashes.length ? hashes : ["-"]), isNull(deviceLogin.revokedAt)))
  ).map((r) => r.hash);
  jar.set(DEVICE_COOKIE, writeDeviceTokens([...tokens.filter((t) => kept.includes(tokenHash(t))), token]), deviceCookieOptions);
  return redirect({ href: "/more/account?pin=ok", locale });
}

/** Removes this person from this phone's quick sign-in list. */
export async function forgetPin(formData: FormData) {
  const locale = z.enum(["ar", "en"]).catch("ar").parse(formData.get("locale"));
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });
  const jar = await cookies();
  const tokens = readDeviceTokens(jar.get(DEVICE_COOKIE)?.value);
  const mine = (await db.select({ hash: deviceLogin.tokenHash }).from(deviceLogin).where(eq(deviceLogin.userId, user.id))).map((r) => r.hash);
  await db.delete(deviceLogin).where(and(eq(deviceLogin.userId, user.id), inArray(deviceLogin.tokenHash, tokens.length ? tokens.map(tokenHash) : ["-"])));
  jar.set(DEVICE_COOKIE, writeDeviceTokens(tokens.filter((t) => !mine.includes(tokenHash(t)))), deviceCookieOptions);
  return redirect({ href: "/more/account?pin=removed", locale });
}
