import { getTranslations } from "next-intl/server";
import { MoreMenu, type MenuGroup } from "@/components/MoreMenu";

/**
 * Settings, split into the groups Khaled asked for (review of phases 0 to 3):
 * nursery setup, money settings, people and access, and records. Shown on the More page and on /settings.
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
  {
    key: "money",
    items: [
      { href: "/settings/fees", key: "fees", admin: true },
      { href: "/settings/price-locks", key: "priceLocks", admin: true },
      { href: "/settings/expenses", key: "expenseCategories", admin: true },
    ],
  },
  { key: "people", items: [{ href: "/settings/users", key: "users", admin: true }] },
  { key: "records", items: [{ href: "/settings/audit", key: "audit", admin: true }] },
] as const;

/** The settings groups this person may open, ready for `MoreMenu`. */
export async function settingsGroups(admin: boolean): Promise<MenuGroup[]> {
  const t = await getTranslations("settings");
  return SETTINGS_GROUPS.map((g) => ({
    testId: `settings-group-${g.key}`,
    title: t(`groups.${g.key}`),
    items: g.items
      .filter((i) => admin || !i.admin)
      .map((i) => ({ id: `settings-${i.key}`, href: i.href, title: t(`menu.${i.key}`), help: t(`menu.${i.key}Help`), icon: i.key })),
  })).filter((g) => g.items.length > 0);
}

export async function SettingsMenu({ admin }: { admin: boolean }) {
  return <MoreMenu groups={await settingsGroups(admin)} />;
}
