import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/session";
import { AuthShell } from "@/components/AuthShell";
import { SetupMfaFlow } from "./SetupMfaFlow";

export default async function SetupMfaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });
  if (user.mfaEnabled) return redirect({ href: "/", locale });
  const t = await getTranslations("mfa");
  return (
    <AuthShell title={t("setupTitle")} intro={t("setupIntro")}>
      <SetupMfaFlow />
    </AuthShell>
  );
}
