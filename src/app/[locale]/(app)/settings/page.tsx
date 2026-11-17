import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireSettings } from "@/lib/require-user";
import { isOrgAdmin } from "@/lib/permissions";
import { PageHeader } from "@/components/settings/Fields";

const ITEMS = [
  { href: "/settings/branches", key: "branches", admin: true },
  { href: "/settings/age-bands", key: "ageBands", admin: true },
  { href: "/settings/calendar", key: "calendar", admin: false },
  { href: "/settings/users", key: "users", admin: true },
  { href: "/settings/values", key: "values", admin: true },
  { href: "/settings/audit", key: "audit", admin: true },
] as const;

export default async function SettingsHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireSettings(locale, "calendar");
  const t = await getTranslations("settings");
  const admin = isOrgAdmin(user);
  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} />
      <ul className="flex flex-col divide-y divide-divider rounded-card border border-border bg-surface">
        {ITEMS.filter((i) => admin || !i.admin).map((i) => (
          <li key={i.key}>
            <Link href={i.href} className="flex min-h-16 items-center gap-3 px-4 py-3" data-testid={`settings-${i.key}`}>
              <span className="flex flex-1 flex-col">
                <span className="text-row-title font-semibold">{t(`menu.${i.key}`)}</span>
                <span className="text-meta text-muted">{t(`menu.${i.key}Help`)}</span>
              </span>
              <Chevron aria-hidden="true" className="size-5 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
