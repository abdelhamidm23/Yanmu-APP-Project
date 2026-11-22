import { getTranslations } from "next-intl/server";
import { requireSettings } from "@/lib/require-user";
import { isOrgAdmin } from "@/lib/permissions";
import { PageHeader } from "@/components/settings/Fields";
import { SettingsMenu } from "@/components/settings/SettingsMenu";

export default async function SettingsHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireSettings(locale, "calendar");
  const t = await getTranslations("settings");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} />
      <SettingsMenu locale={locale} admin={isOrgAdmin(user)} />
    </div>
  );
}
