import { getTranslations } from "next-intl/server";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { appExpenses, centralCosts, firstMonths, kpisByBranch, lastClosedMonth, monthEnd } from "@/db/home";
import { pick } from "@/db/home-view";
import { requireSection } from "@/lib/require-user";
import { CLOSE_VIEW_ROLES, canViewMonth, hasRoleIn } from "@/lib/permissions";
import { todayInCairo } from "@/lib/calendar";
import { COMPARISON_METRICS, betterBranches, branchMetrics, type BranchMonth, type MetricKey } from "@/lib/home";
import { formatPiastres, type Locale } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { Flag } from "@/components/children/BranchTabs";
import { DataStatusChip } from "@/components/closing/DataStatusChip";
import { monthLabel } from "@/components/money/Money";

const addMonths = (month: string, k: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 10);
};

type Branch = { id: string; nameAr: string; nameEn: string; licensed: number | null };

/** One branch's inputs for a month: figures on its last day (today for the current month). */
async function branchMonth(tx: Parameters<Parameters<typeof withUserDb>[1]>[0], b: Branch, month: string, today: string): Promise<BranchMonth> {
  const date = month === `${today.slice(0, 7)}-01` ? today : monthEnd(month);
  const ks = (await kpisByBranch(tx, [b.id], date)).get(b.id)!;
  const v = (key: string) => pick(ks, key);
  const int = (s: string | null | undefined) => BigInt((s ?? "0").split(".")[0]);
  const costs = await centralCosts(tx, b.id, month);
  return {
    branchId: b.id,
    active: Number(int(v("children.active")?.value)),
    licensed: b.licensed ?? 0,
    monthClosed: v("money.billed")?.status === "verified",
    billed: int(v("money.billed")?.value),
    appExpenses: await appExpenses(tx, b.id, month, date),
    central: costs.central,
    salaries: costs.salaries,
    collectionRate: v("money.collection_rate")?.value ?? null,
    incidents: Number(int(v("incidents.month")?.value)),
    overdue: int(v("money.overdue")?.value),
  };
}

/** Branch comparison (spec §9.5, §11.4): normalized figures side by side, the better branch marked, 6-month trend. */
export default async function BranchesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ month?: string }> }) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireSection(locale, "branches");
  const t = await getTranslations("home.compare");
  const tc = await getTranslations("closing");
  const tf = await getTranslations("closing.figures");
  const loc: Locale = locale === "en" ? "en" : "ar";
  const today = todayInCairo();
  const thisMonth = `${today.slice(0, 7)}-01`;

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, CLOSE_VIEW_ROLES, b.id)) as Branch[];
    if (branches.length === 0) return null;
    if (!branches.every((b) => canViewMonth(user, b.id))) return "hidden" as const;
    const ids = branches.map((b) => b.id);
    const first = (await firstMonths(tx, ids)).money ?? thisMonth;
    const months: string[] = [];
    for (let m = thisMonth; m >= first && months.length < 12; m = addMonths(m, -1)) months.push(m);
    const closed = await lastClosedMonth(tx, ids);
    const month = sp.month && months.includes(`${sp.month}-01`) ? `${sp.month}-01` : (closed ?? thisMonth);
    const now = await Promise.all(branches.map((b) => branchMonth(tx, b, month, today)));
    const history: { month: string; rows: BranchMonth[] }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = addMonths(month, -i);
      if (m < first) continue;
      history.push({ month: m, rows: await Promise.all(branches.map((b) => branchMonth(tx, b, m, today))) });
    }
    return { branches, months, month, now, history };
  });
  if (!data) return <Card>{tc("noBranch")}</Card>;
  if (data === "hidden") return <Card>{tf("moneyHidden")}</Card>;
  const { branches, months, month, now, history } = data;
  const name = (id: string) => {
    const b = branches.find((x) => x.id === id)!;
    return loc === "ar" ? b.nameAr : b.nameEn;
  };
  const metrics = new Map(now.map((m) => [m.branchId, branchMetrics(m)]));
  const past = history.map((h) => ({ month: h.month, m: new Map(h.rows.map((r) => [r.branchId, branchMetrics(r)])) }));
  const closed = now.every((m) => m.monthClosed);
  const nf = (frac: number) => new Intl.NumberFormat(`${loc === "ar" ? "ar-EG" : "en-EG"}-u-nu-${user.digits === "arabic" ? "arab" : "latn"}`, { maximumFractionDigits: frac });
  const show = (kind: string, v: bigint | string | null) => {
    if (v === null) return "—";
    if (kind === "piastres") return formatPiastres(v as bigint, loc, user.digits);
    if (kind === "percent") return `${nf(1).format(v as unknown as number)}%`;
    return nf(1).format(v as unknown as number);
  };
  const numeric = (v: bigint | string | null) => (v === null ? null : Number(v));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")} />
      <form method="get" action={`/${locale}/branches`} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="cmp-month" className="text-[13px] font-medium text-subtle">{t("month")}</label>
          <select id="cmp-month" name="month" defaultValue={month.slice(0, 7)} className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]">
            {months.map((m) => (
              <option key={m} value={m.slice(0, 7)}>{monthLabel(m, locale, user.digits)}</option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">{t("show")}</Button>
      </form>
      <Card className="flex flex-wrap items-center gap-2" data-testid="compare-status">
        <DataStatusChip status={closed ? "verified" : "provisional"} />
        <span className="text-[14px] text-subtle">{closed ? t("closedMonth") : t("openMonth")}</span>
      </Card>

      <ul className="flex flex-col gap-3" data-testid="compare">
        {COMPARISON_METRICS.map((def) => {
          const values = branches.map((b) => ({ branchId: b.id, value: metrics.get(b.id)![def.key as MetricKey] }));
          const best = betterBranches(values, def.better);
          // Sparkline: one line per branch over the last 6 months (gaps where a figure is missing).
          const series = branches.map((b) => past.map((p) => numeric(p.m.get(b.id)![def.key as MetricKey])));
          const all = series.flat().filter((x): x is number => x !== null);
          const lo = Math.min(0, ...all);
          const hi = Math.max(1, ...all);
          return (
            <li key={def.key}>
              <Card data-testid={`metric-${def.key}`}>
                <h2 className="font-semibold">{t(`metrics.${def.key}.label`)}</h2>
                <p className="text-meta text-muted">{t(`metrics.${def.key}.help`)}</p>
                <ul className="mt-2 flex flex-col divide-y divide-divider">
                  {values.map((v, i) => (
                    <li key={v.branchId} className="flex min-h-11 items-center justify-between gap-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className={`inline-block size-2.5 rounded-full ${i === 0 ? "bg-brand" : "bg-chart-neutral"}`} aria-hidden="true" />
                        {name(v.branchId)}
                        {best.has(v.branchId) ? <Flag tone="good" testId="better">{t("better")}</Flag> : null}
                      </span>
                      <span className="figure font-semibold" dir="ltr">
                        {v.value === null && (def.key === "costPerChild" || def.key === "resultPerChild" || def.key === "breakEven") ? (
                          <span className="text-meta font-normal text-muted" dir="auto">{t("needsUpload")}</span>
                        ) : (
                          show(def.kind, v.value)
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {past.length > 1 && all.length > 1 ? (
                  <figure className="mt-2">
                    <svg viewBox="0 0 100 24" className="h-8 w-full" role="img" aria-label={t("trend")} preserveAspectRatio="none">
                      {series.map((s, i) => {
                        const pts = s
                          .map((y, x) => (y === null ? null : `${(x * 100) / Math.max(1, s.length - 1)},${22 - ((y - lo) * 20) / (hi - lo || 1)}`))
                          .filter(Boolean)
                          .join(" ");
                        return <polyline key={i} points={pts} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className={i === 0 ? "stroke-brand" : "stroke-chart-neutral"} />;
                      })}
                    </svg>
                    <figcaption className="flex justify-between text-meta text-muted">
                      <span>{monthLabel(past[0].month, locale, user.digits)}</span>
                      <span>{t("trend")}</span>
                      <span>{monthLabel(past[past.length - 1].month, locale, user.digits)}</span>
                    </figcaption>
                  </figure>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
