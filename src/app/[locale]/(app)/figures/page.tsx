import { getTranslations } from "next-intl/server";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { kpis } from "@/db/closing";
import { requireClosing } from "@/lib/require-user";
import { CLOSE_VIEW_ROLES, canViewMonth, hasRoleIn } from "@/lib/permissions";
import { KPI_DEFS, consolidate, type Kpi } from "@/lib/data-status";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber, formatPlainDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, pickBranch } from "@/components/children/BranchTabs";
import { Amount } from "@/components/money/Money";
import { DataStatusChip } from "@/components/closing/DataStatusChip";
import { StatusLegend } from "@/components/StatusLegend";

const GROUPS = ["children", "team", "safety", "closing", "money"] as const;

/** Figures with their data status (spec §6.1, §9): every number says how sure it is; missing is "—", never 0. */
export default async function FiguresPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; date?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireClosing(locale, "figures");
  const t = await getTranslations("closing.figures");
  const tc = await getTranslations("closing");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, CLOSE_VIEW_ROLES, b.id));
    if (branches.length === 0) return null;
    const tabs = branches.length > 1 ? [{ id: "all", nameAr: tc("allBranches"), nameEn: tc("allBranches") }, ...branches] : branches;
    const current = pickBranch(tabs, sp.branch)!;
    const parts = current.id === "all" ? branches : branches.filter((b) => b.id === current.id);
    const perBranch = await Promise.all(parts.map((b) => kpis(tx, b.id, date)));
    const money = parts.every((b) => canViewMonth(user, b.id));
    return { tabs, current, figures: parts.length === 1 ? perBranch[0] : consolidate(perBranch), branchCount: parts.length, money };
  });
  if (!data) return <Card>{tc("noBranch")}</Card>;
  const { tabs, current, figures, branchCount, money } = data;
  const byKey = new Map(figures.map((k) => [k.key, k]));
  const n = (v: number | bigint) => formatNumber(v, loc, user.digits);
  const dec = (v: string) =>
    new Intl.NumberFormat(`${loc === "en" ? "en-EG" : "ar-EG"}-u-nu-${user.digits === "arabic" ? "arab" : "latn"}`, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(v));

  function value(k: Kpi) {
    if (k.value === null) return <span className="figure" aria-label={t("notSubmitted")}>—</span>;
    if (k.key === "close.day") return <span>{t("closedBranches", { n: n(BigInt(k.value)), total: n(branchCount) })}</span>;
    switch (k.kind) {
      case "piastres":
        return <Amount locale={locale} digits={user.digits} value={BigInt(k.value)} />;
      case "percent":
        return <span className="figure" dir="ltr">{dec(k.value)}%</span>;
      case "rate":
        return <span className="figure">{dec(k.value)}</span>;
      default:
        return <span className="figure">{n(BigInt(k.value))}</span>;
    }
  }

  function detail(k: Kpi): string | null {
    const id = k.key.replace(/\./g, "_");
    if (k.done !== null && k.total !== null) return t(`coverage.${id}` as "coverage.attendance_day", { done: n(k.done), total: n(k.total) });
    if (k.key === "staff.present" && k.den) return t("coverage.staff_present", { total: n(BigInt(k.den)) });
    if (k.key === "money.overdue" && k.den) return t("coverage.money_overdue", { total: n(BigInt(k.den)) });
    if (k.key === "incidents.rate") return t("coverage.incidents_rate");
    if (k.key === "children.occupancy" && k.den) return t("coverage.children_occupancy", { total: n(BigInt(k.den)) });
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")} />
      <BranchTabs branches={tabs} current={current.id} path="/figures" locale={locale} label={tc("branch")} />
      <form method="get" action={`/${locale}/figures`} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="branch" value={current.id} />
        <div className="flex flex-col gap-1">
          <label htmlFor="fg-date" className="text-[13px] font-medium text-subtle">{t("date")}</label>
          <input id="fg-date" name="date" type="date" defaultValue={date} max={today} className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]" />
        </div>
        <Button type="submit" variant="secondary">{t("show")}</Button>
      </form>
      <p className="text-meta text-muted">{t("asOf", { date: formatPlainDate(date, loc, user.digits) })}</p>

      {GROUPS.filter((g) => g !== "money" || money).map((g) => (
        <section key={g} className="flex flex-col gap-2" data-testid={`figures-${g}`}>
          <h2 className="text-section-title font-semibold">{t(`groups.${g}`)}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {KPI_DEFS.filter((d) => d.group === g).map((d) => {
              const k = byKey.get(d.key);
              if (!k) return null;
              const id = d.key.replace(/\./g, "_");
              const more = detail(k);
              return (
                <li key={d.key}>
                  <Card className="flex h-full flex-col gap-1" data-testid={`kpi-${id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[14px] text-subtle">{t(`kpis.${id}` as "kpis.children_active")}</h3>
                      <DataStatusChip status={k.status} />
                    </div>
                    <p className="text-[22px] font-semibold">{value(k)}</p>
                    {k.value === null ? <p className="text-meta text-muted">{t.has(`missing.${id}`) ? t(`missing.${id}` as "missing.close_day") : t("missingGeneric")}</p> : more ? <p className="text-meta text-muted">{more}</p> : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!money ? <p className="text-meta text-muted">{t("moneyHidden")}</p> : null}
      <StatusLegend />
    </div>
  );
}
