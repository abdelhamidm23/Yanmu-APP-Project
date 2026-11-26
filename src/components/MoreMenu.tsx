"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  Baby,
  Banknote,
  BarChart3,
  Building2,
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleUser,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Coins,
  History,
  Inbox,
  Lock,
  Receipt,
  ReceiptText,
  Scale,
  Search,
  Shapes,
  SlidersHorizontal,
  Sun,
  Tags,
  UserCog,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";

const ICONS = {
  today: Sun,
  rollCall: ClipboardCheck,
  inbox: Inbox,
  children: Baby,
  staff: Users,
  staffAttendance: Clock,
  incidents: AlertTriangle,
  issues: Wrench,
  paid: CircleCheck,
  money: Wallet,
  invoices: Receipt,
  payments: Banknote,
  cashBox: Coins,
  expenses: ReceiptText,
  priceLocks: Lock,
  dailyClose: ClipboardList,
  monthClose: CalendarCheck,
  figures: BarChart3,
  branches: Building2,
  ageBands: Scale,
  calendar: CalendarDays,
  values: SlidersHorizontal,
  fees: Tags,
  expenseCategories: Shapes,
  users: UserCog,
  audit: History,
  account: CircleUser,
} satisfies Record<string, LucideIcon>;
export type MenuIcon = keyof typeof ICONS;

export interface MenuItem {
  id: string;
  href: string;
  title: string;
  help: string;
  icon: MenuIcon;
}
export interface MenuGroup {
  /** Used for the test id: `more-group-<key>` or `settings-group-<key>`. */
  testId: string;
  title: string;
  items: MenuItem[];
}

/** Lower-case, and Arabic letters that people type either way made the same (أ/إ/آ → ا, ة → ه, ى → ي). */
function fold(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[ً-ْ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim();
}

/**
 * The More page and /settings: screens in named groups, as rows with an icon (owner, 2026-11-26:
 * "categorize things and make it easy to find"). With `searchable`, a box at the top narrows the
 * rows to the ones whose name or description contains the words typed, in Arabic or English.
 */
export function MoreMenu({ groups, searchable = false }: { groups: MenuGroup[]; searchable?: boolean }) {
  const t = useTranslations("more");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight;
  const words = fold(query).split(/\s+/).filter(Boolean);
  const matches = (i: MenuItem) => words.every((w) => fold(`${i.title} ${i.help}`).includes(w));
  const shown = groups.map((g) => ({ ...g, items: g.items.filter(matches) })).filter((g) => g.items.length > 0);

  return (
    <>
      {searchable ? (
        <div className="relative">
          <label htmlFor="more-search" className="sr-only">
            {t("search")}
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
          <input
            id="more-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            autoComplete="off"
            className="min-h-12 w-full rounded-button border border-outline bg-surface ps-11 pe-3 text-[15px]"
            data-testid="more-search"
          />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-muted" role="status" data-testid="more-search-empty">
          {t("searchEmpty", { query: query.trim() })}
        </p>
      ) : null}
      {shown.map((g) => (
        <section key={g.testId} className="flex flex-col gap-2" data-testid={g.testId}>
          <h2 className="text-section-title font-semibold">{g.title}</h2>
          <ul className="flex flex-col divide-y divide-divider rounded-card border border-border bg-surface">
            {g.items.map((i) => {
              const Icon = ICONS[i.icon];
              return (
                <li key={i.id}>
                  <Link href={i.href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-bg" data-testid={i.id}>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-row-title font-semibold">{i.title}</span>
                      <span className="text-meta text-muted">{i.help}</span>
                    </span>
                    <Chevron aria-hidden="true" className="size-5 shrink-0 text-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
