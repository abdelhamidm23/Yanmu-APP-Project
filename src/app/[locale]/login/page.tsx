import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/session";
import { AuthShell } from "@/components/AuthShell";
import { DEMO_ACCOUNTS, isDemoMode } from "@/lib/demo";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (await getCurrentUser()) return redirect({ href: "/", locale });
  const t = await getTranslations();
  const demo = isDemoMode()
    ? {
        password: process.env.DEV_USER_PASSWORD ?? "Yanmu-dev-2026!",
        accounts: DEMO_ACCOUNTS.map((a) => ({
          email: a.email,
          label: a.roles.map(([role, branch]) => `${t(`roles.${role}`)}${branch ? ` ${t("auth.demoBranch", { code: branch })}` : ""}`).join(" + "),
        })),
      }
    : undefined;
  return (
    <AuthShell title={t("auth.signInTitle")} intro={t("auth.signInIntro")}>
      <LoginForm demo={demo} />
    </AuthShell>
  );
}
