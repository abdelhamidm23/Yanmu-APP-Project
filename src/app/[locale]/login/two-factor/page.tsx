import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/AuthShell";
import { TwoFactorForm } from "./TwoFactorForm";

export default async function TwoFactorPage() {
  const t = await getTranslations("auth");
  return (
    <AuthShell title={t("twoFactorTitle")} intro={t("twoFactorIntro")}>
      <TwoFactorForm />
    </AuthShell>
  );
}
