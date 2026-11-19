import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";

/**
 * Settings, split into the groups Khaled asked for (review of phases 0 to 3):
 * nursery setup, people and access, and records. Shown on the More page and on /settings.
 */
export const SETTINGS_GROUPS = [
  {
    key: "setup",
    items: [
      { href: "/settings/branches", key: "branches", admin: true },
      { href: "/settings/age-bands", key: "ageBands", admin: true },
      { href: "/settings/calendar", key: "calendar", admin: false },
      { href: "/settings/values", key: "values", admin: true },
    ],
  },
  { key: "people", items: [{ href: "/settings/users", key: "users", admin: true }] },
  { key: "records", items: [{ href: "/settings/audit", key: "audit", admin: true }] },
] as const;

export async function SettingsMenu({ locale, admin }: { locale: string; admin: boolean }) {
  const t = await getTranslations("settings");
  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight;
  return (
    <>
      {SETTINGS_GROUPS.map((g) => {
        const items = g.items.filter((i) => admin || !i.admin);
        if (items.length === 0) return null;
        return (
          <section key={g.key} className="flex flex-col gap-2" data-testid={`settings-group-${g.key}`}>
            <h2 className="text-section-title font-semibold">{t(`groups.${g.key}`)}</h2>
            <ul className="flex flex-col divide-y divide-divider rounded-card border border-border bg-surface">
              {items.map((i) => (
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
          </section>
        );
      })}
    </>
  );
}
