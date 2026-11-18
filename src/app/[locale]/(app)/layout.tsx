import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppNav } from "@/components/AppNav";
import { DemoPill } from "@/components/DemoPill";
import { ServiceWorker } from "@/components/ServiceWorker";
import { NAV_BY_ROLE } from "@/lib/roles";
import { requireUser } from "@/lib/require-user";

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
            {user.activeRole ? (
              <span className="rounded-full bg-brand-tint px-3 py-1 text-meta font-medium text-brand" data-testid="active-role">
                {t(`roles.${user.activeRole}`)}
              </span>
            ) : null}
          </div>
        </div>
      </header>
      <ServiceWorker />
      <AppNav items={items} />
      <main id="main" className="mx-auto max-w-3xl px-4 pb-28 pt-5 md:ms-60 md:max-w-4xl md:px-8 md:pb-10">
        {children}
      </main>
    </div>
  );
}
