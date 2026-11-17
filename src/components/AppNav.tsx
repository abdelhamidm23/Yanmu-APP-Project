"use client";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import type { NavItem } from "@/lib/roles";
import { NavIcon } from "./NavIcon";

/**
 * Bottom navigation on phones, sidebar on desktop (docs/SPEC.md §11.1).
 * Items come from the server, already filtered for the active role.
 */
export function AppNav({ items, badges = {} }: { items: NavItem[]; badges?: Partial<Record<string, number>> }) {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("common.mainNav")}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:inset-x-auto md:start-0 md:top-0 md:w-60 md:border-t-0 md:border-e md:pb-0 md:pt-20"
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-around md:max-w-none md:flex-col md:gap-1 md:px-3">
        {items.map((item) => {
          const href = `/${item.section}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const count = item.badge ? badges[item.section] ?? 0 : 0;
          return (
            <li key={item.section} className="flex-1 md:flex-none">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                data-testid={`nav-${item.section}`}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-nav font-medium md:min-h-11 md:flex-row md:justify-start md:gap-3 md:rounded-button md:px-3 md:text-[14px] ${
                  active ? "text-brand" : "text-muted"
                } ${active ? "md:bg-brand-tint" : "md:hover:bg-bg"}`}
              >
                <span
                  className={
                    item.primary
                      ? "flex size-9 items-center justify-center rounded-full bg-brand text-white md:size-7"
                      : "flex size-7 items-center justify-center"
                  }
                >
                  <NavIcon name={item.icon} className={item.primary ? "size-5" : "size-6 md:size-5"} />
                </span>
                <span>{t(`nav.${item.section}`)}</span>
                {count > 0 ? (
                  <span className="figure absolute top-1.5 start-[calc(50%+6px)] min-w-5 rounded-full bg-attention px-1.5 text-center text-[11px] font-semibold leading-5 text-white md:static md:ms-auto">
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
