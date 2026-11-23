import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppNav } from "@/components/AppNav";
import { DemoPill } from "@/components/DemoPill";
import { ServiceWorker } from "@/components/ServiceWorker";
import { NAV_BY_ROLE } from "@/lib/roles";
import { requireUser } from "@/lib/require-user";
import { myTurnToDecide } from "@/lib/permissions";
import { withUserDb } from "@/db/rls";
import { openMoneyRequests } from "@/db/money";
import { pendingCritical, unreadAlertCount } from "@/db/safety";
import { Bell } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { AlertWatcher } from "@/components/alerts/AlertWatcher";
import { CriticalBanner } from "@/components/alerts/CriticalBanner";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const t = await getTranslations();
  const items = user.activeRole ? NAV_BY_ROLE[user.activeRole] : NAV_BY_ROLE.teacher.filter((i) => i.section === "more");
  // Inbox badge: money approvals waiting for this person's decision (spec §8.6) plus unread alerts (spec §10).
  const { pending, unread, decisions } = await withUserDb(user.id, async (tx) => ({
    pending: await pendingCritical(tx, user.id),
    unread: await unreadAlertCount(tx, user.id),
    decisions: items.some((i) => i.section === "inbox") ? (await openMoneyRequests(tx)).filter((r) => myTurnToDecide(user, r)).length : 0,
  }));
  const badges: Record<string, number> = { inbox: decisions + unread };

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-button focus:bg-surface focus:p-3">
        {t("app.skipToContent")}
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-3xl items-center justify-between gap-3 px-4 md:ms-60 md:max-w-none md:px-8">
          <span className="text-row-title font-semibold text-brand">{t("app.name")}</span>
          <div className="flex items-center gap-2">
            <DemoPill />
            <Link
              href="/inbox"
              className="relative inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface"
              aria-label={t("alerts.bellCount", { count: unread, n: String(unread) })}
              data-testid="alert-bell"
            >
              <Bell className="size-6" aria-hidden="true" />
              {unread > 0 ? (
                <span className="figure absolute top-1 end-1 min-w-5 rounded-full bg-critical px-1 text-center text-[11px] font-semibold leading-5 text-white" data-testid="alert-bell-count">
                  {unread}
                </span>
              ) : null}
            </Link>
            {user.activeRole ? (
              <span className="rounded-full bg-brand-tint px-3 py-1 text-meta font-medium text-brand" data-testid="active-role">
                {t(`roles.${user.activeRole}`)}
              </span>
            ) : null}
          </div>
        </div>
        <CriticalBanner pending={pending} locale={locale} />
      </header>
      <ServiceWorker />
      <AlertWatcher userId={user.id} critical={pending.map((p) => p.id)} unread={unread} />
      <AppNav items={items} badges={badges} />
      <main id="main" className="mx-auto max-w-3xl px-4 pb-28 pt-5 md:ms-60 md:max-w-4xl md:px-8 md:pb-10">
        {children}
      </main>
    </div>
  );
}
