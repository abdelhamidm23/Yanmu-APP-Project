import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { firstMonths } from "@/db/home";
import { requireSection } from "@/lib/require-user";
import { CLOSE_VIEW_ROLES, canViewMonth, hasRoleIn } from "@/lib/permissions";
import { todayInCairo } from "@/lib/calendar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { monthLabel } from "@/components/money/Money";

const addMonths = (month: string, k: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 10);
};

/** Reports (spec §11.1, owner's fourth tab): the monthly report in Excel and the lists to export. */
export default async function ReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireSection(locale, "reports");
  const t = await getTranslations("home.reports");
  const today = todayInCairo();
  const thisMonth = `${today.slice(0, 7)}-01`;
  const loc = locale === "en" ? "en" : "ar";

  const { branches, months, money } = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, CLOSE_VIEW_ROLES, b.id));
    const first = (await firstMonths(tx, branches.map((b) => b.id))).money ?? thisMonth;
    const months: string[] = [];
    for (let m = thisMonth; m >= first && months.length < 24; m = addMonths(m, -1)) months.push(m);
    if (months.length === 0) months.push(thisMonth);
    return { branches, months, money: branches.length > 0 && branches.every((b) => canViewMonth(user, b.id)) };
  });
  const name = (b: { nameAr: string; nameEn: string }) => (loc === "ar" ? b.nameAr : b.nameEn);
  const linkCls = "flex min-h-12 items-center justify-between gap-2 px-4 py-2 text-[15px] hover:bg-bg";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")} />

      <Card data-testid="monthly-report">
        <h2 className="text-section-title font-semibold">{t("monthly")}</h2>
        <p className="mt-1 text-[14px] text-subtle">{t("monthlyHelp")}</p>
        <form method="get" action="/api/reports/monthly" className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="locale" value={loc} />
          <div className="flex flex-col gap-1">
            <label htmlFor="rp-month" className="text-[13px] font-medium text-subtle">{t("month")}</label>
            <select id="rp-month" name="month" defaultValue={months[1]?.slice(0, 7) ?? months[0].slice(0, 7)} className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]">
              {months.map((m) => (
                <option key={m} value={m.slice(0, 7)}>{monthLabel(m, locale, user.digits)}</option>
              ))}
            </select>
          </div>
          <Button type="submit" data-testid="download-monthly">{t("download")}</Button>
        </form>
      </Card>

      <h2 className="text-section-title font-semibold">{t("screens")}</h2>
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        <li><Link href="/figures" className={linkCls}>{t("links.figures")}</Link></li>
        {money ? <li><Link href="/branches" className={linkCls}>{t("links.compare")}</Link></li> : null}
        {money ? branches.map((b) => (
          <li key={b.id}><Link href={`/month-close?branch=${b.id}`} className={linkCls}>{t("links.monthClose")} · {name(b)}</Link></li>
        )) : null}
      </ul>

      <h2 className="text-section-title font-semibold">{t("lists")}</h2>
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="report-lists">
        {money ? <li><a href={`/api/reports/overdue?branch=all&locale=${loc}`} className={linkCls}>{t("links.overdue")}</a></li> : null}
        {branches.map((b) => (
          <li key={`i-${b.id}`}><a href={`/api/export/incidents?branch=${b.id}&locale=${loc}`} className={linkCls}>{t("links.incidents")} · {name(b)}</a></li>
        ))}
        {branches.map((b) => (
          <li key={`s-${b.id}`}><a href={`/api/export/issues?branch=${b.id}&locale=${loc}`} className={linkCls}>{t("links.issues")} · {name(b)}</a></li>
        ))}
        {branches.map((b) => (
          <li key={`p-${b.id}`}><a href={`/api/export/pay-status?branch=${b.id}&locale=${loc}`} className={linkCls}>{t("links.payStatus")} · {name(b)}</a></li>
        ))}
      </ul>
    </div>
  );
}
