import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/session";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (await getCurrentUser()) return redirect({ href: "/", locale });
  const t = await getTranslations("auth");
  return (
    <AuthShell title={t("signInTitle")} intro={t("signInIntro")}>
      <LoginForm />
    </AuthShell>
  );
}
