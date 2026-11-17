"use server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser, ACTIVE_ROLE_COOKIE } from "@/lib/session";
import { homeSection, ROLES } from "@/lib/roles";

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
  return redirect({ href: "/more?saved=1", locale: prefs.locale });
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
