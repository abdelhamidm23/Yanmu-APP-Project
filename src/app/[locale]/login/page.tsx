import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { and, inArray, isNull, eq } from "drizzle-orm";
import { db } from "@/db";
import { appUser, deviceLogin } from "@/db/schema";
import { DEVICE_COOKIE, readDeviceTokens, tokenHash } from "@/lib/pin";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/session";
import { AuthShell } from "@/components/AuthShell";
import { DEMO_ACCOUNTS, DEMO_BRANCH_NAMES, isDemoMode } from "@/lib/demo";
import { LoginForm } from "./LoginForm";
import { PinLogin } from "./PinLogin";

/** People who set up quick sign-in on this phone (first name only on the shared screen). */
async function peopleOnThisPhone() {
  const tokens = readDeviceTokens((await cookies()).get(DEVICE_COOKIE)?.value);
  if (!tokens.length) return [];
  const rows = await db
    .select({ id: deviceLogin.id, name: appUser.name, hasPin: appUser.pinHash })
    .from(deviceLogin)
    .innerJoin(appUser, eq(appUser.id, deviceLogin.userId))
    .where(and(inArray(deviceLogin.tokenHash, tokens.map(tokenHash)), isNull(deviceLogin.revokedAt)));
  return rows.filter((r) => r.hasPin).map((r) => ({ id: r.id, name: r.name.split(/\s+/)[0] }));
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (await getCurrentUser()) return redirect({ href: "/", locale });
  const t = await getTranslations();
  const demo = isDemoMode()
    ? {
        password: process.env.DEV_USER_PASSWORD ?? "Yanmu-dev-2026!",
        accounts: DEMO_ACCOUNTS.map((a) => ({
          email: a.email,
          label: a.roles
            .map(([role, branch]) => `${t(`roles.${role}`)}${branch ? ` ${t("auth.demoBranch", { code: DEMO_BRANCH_NAMES[branch][locale === "en" ? "en" : "ar"] })}` : ""}`)
            .join(" + "),
        })),
      }
    : undefined;
  const people = await peopleOnThisPhone();
  return (
    <AuthShell title={t("auth.signInTitle")} intro={t("auth.signInIntro")}>
      {people.length ? <PinLogin people={people} /> : null}
      <LoginForm demo={demo} />
    </AuthShell>
  );
}
