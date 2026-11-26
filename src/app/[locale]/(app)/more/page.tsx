import { getTranslations } from "next-intl/server";
import { requireSection } from "@/lib/require-user";
import {
  canOpenSettings,
  isOrgAdmin,
  canOpenToday,
  canViewMoney,
  canViewPayStatus,
  canUseCashBox,
  canReconcileCash,
  canDecideMoney,
  canViewExpenses,
  canTakeAttendance,
  canViewChildren,
  canViewStaff,
  canViewStaffAttendance,
  canOpenSafety,
  canCloseDay,
  canViewCloses,
  canViewMonth,
} from "@/lib/permissions";
import { canOpenSection } from "@/lib/roles";
import { MoreMenu, type MenuGroup, type MenuIcon } from "@/components/MoreMenu";
import { settingsGroups } from "@/components/settings/SettingsMenu";
import { SignOutButton } from "./SignOutButton";

type Entry = { show: boolean; id: string; href: string; title: string; help: string; icon: MenuIcon };

/**
 * More (owner, 2026-11-26): every screen beyond the person's tabs, in groups by kind of work,
 * with a search box when the list is long. The person's own settings (language, PIN, security)
 * are on My account (/more/account). Each row is shown only to roles the server lets open it.
 */
export default async function MorePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireSection(locale, "more");
  const t = await getTranslations();
  const hasTab = (section: string) => Boolean(user.activeRole && canOpenSection(user.activeRole, section));
  const role = user.activeRole ? t(`roles.${user.activeRole}`) : null;

  const group = (key: string, title: string, entries: Entry[]): MenuGroup => ({
    testId: `more-group-${key}`,
    title,
    items: entries.filter((e) => e.show).map(({ id, href, title, help, icon }) => ({ id, href, title, help, icon })),
  });

  const groups: MenuGroup[] = [
    group("account", t("more.groups.account"), [
      { show: true, id: "open-account", href: "/more/account", title: user.name, help: `${role ? `${role} · ` : ""}${t("more.accountHelp")}`, icon: "account" },
    ]),
    group("daily", t("more.groups.daily"), [
      { show: canOpenToday(user) && !hasTab("today"), id: "open-today", href: "/today", title: t("today.title"), help: t("more.todayLink"), icon: "today" },
      { show: canTakeAttendance(user) && !hasTab("roll-call"), id: "open-roll-call", href: "/roll-call", title: t("attendance.rollCallTitle"), help: t("more.rollCallLink"), icon: "rollCall" },
      { show: !hasTab("inbox"), id: "open-alerts", href: "/inbox", title: t("alerts.inboxTitle"), help: t("more.alertsLink"), icon: "inbox" },
    ]),
    group("people", t("more.groups.people"), [
      { show: canViewChildren(user) && !hasTab("children"), id: "open-children", href: "/children", title: t("more.children"), help: t("more.childrenLink"), icon: "children" },
      { show: canViewStaff(user) && !hasTab("staff"), id: "open-staff", href: "/staff", title: t("staff.title"), help: t("more.staffLink"), icon: "staff" },
      {
        show: canViewStaffAttendance(user) && !hasTab("staff-attendance"),
        id: "open-staff-attendance",
        href: "/staff-attendance",
        title: t("staffAttendance.title"),
        help: t("more.staffAttendanceLink"),
        icon: "staffAttendance",
      },
    ]),
    group("safety", t("more.groups.safety"), [
      { show: canOpenSafety(user), id: "open-incidents", href: "/incidents", title: t("safety.incidents.title"), help: t("more.incidentsLink"), icon: "incidents" },
      { show: canOpenSafety(user) && !hasTab("issues"), id: "open-issues", href: "/issues", title: t("safety.issues.title"), help: t("more.issuesLink"), icon: "issues" },
    ]),
    group("money", t("more.groups.money"), [
      { show: canViewPayStatus(user) && !canViewMoney(user) && !hasTab("paid"), id: "open-paid", href: "/paid", title: t("money.paid.title"), help: t("more.paidLink"), icon: "paid" },
      { show: canViewMoney(user) && !hasTab("money"), id: "open-money", href: "/money", title: t("money.title"), help: t("more.moneyLink"), icon: "money" },
      { show: canViewMoney(user) && !hasTab("invoices"), id: "open-invoices", href: "/invoices", title: t("money.links.invoices"), help: t("more.invoicesLink"), icon: "invoices" },
      { show: canViewMoney(user), id: "open-payments", href: "/payments", title: t("money.links.payments"), help: t("more.paymentsLink"), icon: "payments" },
      {
        show: (canUseCashBox(user) || canReconcileCash(user) || canDecideMoney(user)) && !hasTab("cash-box"),
        id: "open-cash-box",
        href: "/cash-box",
        title: t("money.links.cashBox"),
        help: t("more.cashBoxLink"),
        icon: "cashBox",
      },
      { show: canViewExpenses(user), id: "open-expenses", href: "/expenses", title: t("money.links.expenses"), help: t("more.expensesLink"), icon: "expenses" },
      {
        show: canViewMoney(user) && !isOrgAdmin(user),
        id: "open-price-locks",
        href: "/settings/price-locks",
        title: t("money.links.priceLocks"),
        help: t("more.priceLocksLink"),
        icon: "priceLocks",
      },
    ]),
    group("closing", t("more.groups.closing"), [
      { show: canCloseDay(user) || canViewCloses(user), id: "open-daily-close", href: "/daily-close", title: t("closing.day.title"), help: t("more.dailyCloseLink"), icon: "dailyClose" },
      { show: canViewMonth(user) && !hasTab("month-close"), id: "open-month-close", href: "/month-close", title: t("closing.month.title"), help: t("more.monthCloseLink"), icon: "monthClose" },
      { show: canViewCloses(user), id: "open-figures", href: "/figures", title: t("closing.figures.title"), help: t("more.figuresLink"), icon: "figures" },
    ]),
    ...(canOpenSettings(user) ? await settingsGroups(isOrgAdmin(user)) : []),
  ].filter((g) => g.items.length > 0);

  const rows = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold">{t("nav.more")}</h1>
      <MoreMenu groups={groups} searchable={rows >= 8} />
      <div className="mt-2">
        <SignOutButton />
      </div>
    </div>
  );
}
