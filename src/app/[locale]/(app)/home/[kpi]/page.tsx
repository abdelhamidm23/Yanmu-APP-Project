import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { homeScope, combine, pick } from "@/db/home-view";
import { breachesOn, callLimits, classAttendance, firstMonths, isWorking, kpisByBranch, monthEnd, overdueAgeing, overdueFamilies } from "@/db/home";
import { overdueActions } from "@/db/safety";
import { requireSection } from "@/lib/require-user";
import { hasRoleIn } from "@/lib/permissions";
import { todayInCairo } from "@/lib/calendar";
import { divRound } from "@/lib/home";
import { formatNumber, formatPiastres, formatPlainDate, formatTimestamp, type Locale } from "@/lib/format";
import type { Kpi } from "@/lib/data-status";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BranchTabs, Flag } from "@/components/children/BranchTabs";
import { DataStatusChip } from "@/components/closing/DataStatusChip";
import { Amount, monthLabel } from "@/components/money/Money";
import { Alert } from "@/components/ui/Alert";
import { CompactMoney } from "@/components/home/Home";
import { askToCall } from "./actions";

/** Which figures have a detail page, how their trend runs and which records sit behind them (spec §11.3). */
const DETAILS = {
  money_billed: { key: "money.billed", trend: "month", origin: "money", money: true },
  money_collected: { key: "money.collected", trend: "month", origin: "money", money: true },
  money_collection_rate: { key: "money.collection_rate", trend: "month", origin: "money", money: true },
  money_overdue: { key: "money.overdue", trend: "none", origin: "money", money: true },
  money_result: { key: "money.result", trend: "month", origin: "money", money: true },
  children_active: { key: "children.active", trend: "month", origin: "children", money: false },
  children_occupancy: { key: "children.occupancy", trend: "month", origin: "children", money: false },
  attendance_day: { key: "attendance.day", trend: "day", origin: "operations", money: false },
  staff_present: { key: "staff.present", trend: "day", origin: "operations", money: false },
  ratio_breaches: { key: "ratio.breaches", trend: "day", origin: "operations", money: false },
  incidents_open_critical: { key: "incidents.open_critical", trend: "none", origin: "operations", money: false },
  incidents_month: { key: "incidents.month", trend: "month", origin: "operations", money: false },
  actions_overdue: { key: "actions.overdue", trend: "none", origin: "operations", money: false },
} as const;
type DetailId = keyof typeof DETAILS;

const addMonths = (month: string, k: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return d.toISOString().slice(0, 10);
};
const addDays = (iso: string, k: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

export default async function KpiDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; kpi: string }>;
  searchParams: Promise<{ branch?: string; ok?: string; done?: string; n?: string; error?: string }>;
}) {
  const { locale, kpi } = await params;
  const sp = await searchParams;
  const user = await requireSection(locale, "home");
  if (!(kpi in DETAILS)) notFound();
  const id = kpi as DetailId;
  const def = DETAILS[id];
  const t = await getTranslations("home");
  const td = await getTranslations("home.detail");
  const tc = await getTranslations("closing");
  const tf = await getTranslations("closing.figures");
  const tm = await getTranslations("money");
  const loc: Locale = locale === "en" ? "en" : "ar";
  const today = todayInCairo();
  const thisMonth = `${today.slice(0, 7)}-01`;

  const data = await withUserDb(user.id, async (tx) => {
    const scope = await homeScope(tx, user, sp.branch, { ar: tc("allBranches"), en: tc("allBranches") });
    if (!scope) return null;
    if (def.money && !scope.money) return "hidden" as const;
    const ids = scope.parts.map((b) => b.id);
    const per = await kpisByBranch(tx, ids, today);
    const figure = pick(combine(per, ids), def.key);

    // Trend: 12 months (month-end figures; this month so far) or the last 14 days' working days.
    const trend: { label: string; k: Kpi | undefined; before: boolean }[] = [];
    if (def.trend === "month") {
      const first = (await firstMonths(tx, ids))[def.origin];
      for (let i = 11; i >= 0; i--) {
        const m = addMonths(thisMonth, -i);
        const before = !first || m < first;
        const k = before ? undefined : pick(combine(await kpisByBranch(tx, ids, i === 0 ? today : monthEnd(m)), ids), def.key);
        trend.push({ label: monthLabel(m, locale, user.digits), k, before });
      }
    } else if (def.trend === "day") {
      const first = (await firstMonths(tx, ids)).operations;
      for (let i = 13; i >= 0; i--) {
        const d = addDays(today, -i);
        let working = false;
        for (const b of ids) working ||= await isWorking(tx, b, d);
        if (!working) continue;
        const before = !first || d < first;
        const k = before ? undefined : pick(combine(await kpisByBranch(tx, ids, d), ids), def.key);
        trend.push({ label: formatPlainDate(d, loc, user.digits), k, before });
      }
    }

    // Records behind the figure.
    const classes = id === "attendance_day" ? await Promise.all(scope.parts.map(async (b) => ({ b, rows: await classAttendance(tx, b.id, today) }))) : [];
    const breaches = id === "ratio_breaches" ? await Promise.all(scope.parts.map(async (b) => ({ b, rows: await breachesOn(tx, b.id, today) }))) : [];
    const late = id === "actions_overdue" ? (await overdueActions(tx, null)).filter((o) => ids.includes(o.branchId)) : [];
    const ageing = id === "money_overdue" ? await Promise.all(ids.map((b) => overdueAgeing(tx, b, today))) : [];
    const families = id === "money_overdue" ? (await Promise.all(ids.map((b) => overdueFamilies(tx, b, today)))).flat().sort((a, b) => b.days - a.days || Number(BigInt(b.amount) - BigInt(a.amount))) : [];
    const limits = id === "money_overdue" ? await callLimits(tx, ids[0]) : null;
    return { scope, per, figure, trend, classes, breaches, late, ageing, families, limits };
  });
  if (!data) return <Card>{tc("noBranch")}</Card>;
  if (data === "hidden") return <Card>{tf("moneyHidden")}</Card>;
  const { scope, per, figure, trend, classes, breaches, late, ageing, families, limits } = data;
  const n = (v: number | bigint) => formatNumber(v, loc, user.digits);
  const big = (v: string | null) => BigInt((v ?? "0").split(".")[0]);
  const pct = (v: string) => new Intl.NumberFormat(`${loc === "ar" ? "ar-EG" : "en-EG"}-u-nu-${user.digits === "arabic" ? "arab" : "latn"}`, { maximumFractionDigits: 1 }).format(v as unknown as number);
  const branchName = (b: { nameAr: string; nameEn: string }) => (loc === "ar" ? b.nameAr : b.nameEn);
  const q = `branch=${scope.current.id}`;

  function show(k: Kpi | undefined, compact = true) {
    if (!k || k.value === null) return <span className="figure">—</span>;
    if (k.kind === "piastres")
      return compact ? <CompactMoney value={big(k.value)} locale={loc} digits={user.digits} /> : <Amount value={big(k.value)} locale={locale} digits={user.digits} />;
    if (k.kind === "percent") return <span className="figure" dir="ltr">{pct(k.value)}%</span>;
    if (k.kind === "rate") return <span className="figure">{pct(k.value)}</span>;
    return <span className="figure">{n(big(k.value))}</span>;
  }
  const title = id === "money_result" ? tf("kpis.money_result") : t(`tiles.${id}` as "tiles.money_billed");

  // By branch, with the per-active-child figure for money (highest highlighted).
  const rows = scope.parts.map((b) => {
    const ks = per.get(b.id)!;
    const k = pick(ks, def.key);
    const active = big(pick(ks, "children.active")?.value ?? "0");
    const perChild = k && k.kind === "piastres" && k.value !== null && active > 0n ? divRound(big(k.value), active) : null;
    return { b, k, perChild };
  });
  const maxPerChild = rows.reduce<bigint | null>((m, r) => (r.perChild !== null && (m === null || r.perChild > m) ? r.perChild : m), null);
  const trendMax = trend.reduce((m, x) => {
    const v = x.k?.value ? Math.abs(Number(x.k.value)) : 0;
    return v > m ? v : m;
  }, 0);

  const links: { href: string; key: string }[] = [];
  const each = scope.parts;
  const add = (path: (b: string) => string, key: string) => each.forEach((b) => links.push({ href: path(b.id), key: `${key}|${b.id}` }));
  if (id === "money_billed" || id === "money_collection_rate") add((b) => `/invoices?branch=${b}&view=all`, "invoices");
  if (id === "money_overdue") add((b) => `/invoices?branch=${b}&view=overdue`, "overdueInvoices");
  if (id === "money_collected") add((b) => `/payments?branch=${b}`, "payments");
  if (id === "money_result") add((b) => `/month-close?branch=${b}`, "monthClose");
  if (id === "children_active" || id === "children_occupancy") add((b) => `/children?branch=${b}`, "children");
  if (id === "staff_present" || id === "ratio_breaches") add((b) => `/staff-attendance?branch=${b}`, "staffAttendance");
  if (id === "incidents_open_critical") add((b) => `/incidents?branch=${b}&view=critical`, "critical");
  if (id === "incidents_month") add((b) => `/incidents?branch=${b}&view=all`, "incidents");
  if (id === "actions_overdue") add((b) => `/issues?branch=${b}&view=overdue`, "issues");
  links.push({ href: `/figures?${q}`, key: "figures|" });

  const canAsk = scope.parts.some((b) => hasRoleIn(user, ["owner", "company_manager"], b.id));

  return (
    <div className="flex flex-col gap-4" data-testid={`detail-${id}`}>
      <Link href={`/home?${q}`} className="inline-flex min-h-11 w-fit items-center font-semibold text-brand underline">
        {td("back")}
      </Link>
      <BranchTabs branches={scope.tabs} current={scope.current.id} path={`/home/${id}`} locale={locale} label={t("branch")} />
      {sp.ok && sp.done === "asked" ? <Alert tone="good">{t("asked", { count: Number(sp.n ?? "1"), n: n(Number(sp.n ?? "1")) })}</Alert> : null}
      {sp.error ? <Alert>{t.has(`errors.${sp.error}`) ? t(`errors.${sp.error}` as "errors.unknown") : t("errors.unknown")}</Alert> : null}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-page-title font-semibold">{title}</h1>
          {figure ? <DataStatusChip status={figure.status} /> : null}
        </div>
        <p className="text-meta text-muted">{td("asOf", { date: formatPlainDate(today, loc, user.digits) })}</p>
        <p className="mt-2 text-[32px] leading-tight font-semibold" data-testid="detail-value">{show(figure, false)}</p>
        {id === "money_overdue" && figure?.den ? <p className="text-[15px] text-subtle">{td("familiesN", { count: Number(figure.den), n: n(Number(figure.den)) })}</p> : null}
        {figure?.done != null && figure.total != null && tf.has(`coverage.${id}`) ? (
          <p className="text-[15px] text-subtle">{tf(`coverage.${id}` as "coverage.attendance_day", { done: n(figure.done), total: n(figure.total) })}</p>
        ) : null}
      </Card>

      {id === "money_overdue" ? (
        <>
          <Card data-testid="ageing">
            <h2 className="text-section-title font-semibold">{td("ageing")}</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {(["d1_30", "d31_60", "d60_plus"] as const).map((k, i) => {
                const amount = ageing.reduce((s, a) => s + a[i].amount, 0n);
                const fams = ageing.reduce((s, a) => s + a[i].families, 0);
                const total = ageing.flat().reduce((s, a) => s + a.amount, 0n);
                const width = total > 0n ? Number((amount * 100n) / total) : 0;
                return (
                  <li key={k} className="flex flex-col gap-1">
                    <span className="flex justify-between gap-2 text-[14px]">
                      <span>{tm(`ageing.${k}`)}</span>
                      <span className="figure font-semibold">{formatPiastres(amount, loc, user.digits)} · {td("familiesN", { count: fams, n: n(fams) })}</span>
                    </span>
                    <span className="h-3 w-full overflow-hidden rounded-full bg-provisional-bg" aria-hidden="true">
                      <span className={`block h-full rounded-full ${i === 2 ? "bg-critical" : i === 1 ? "bg-attention" : "bg-chart-neutral"}`} style={{ inlineSize: `${width}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card data-testid="longest">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-section-title font-semibold">{td("longest")}</h2>
              <a href={`/api/reports/overdue?${q}&locale=${loc}`} className="inline-flex min-h-11 items-center font-semibold text-brand underline" data-testid="export-overdue">
                {td("export")}
              </a>
            </div>
            {families.length === 0 ? <p className="mt-2 text-[14px] text-subtle">—</p> : null}
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="text-meta text-muted">
                    <th className="py-2 text-start font-medium">{td("cols.account")}</th>
                    {scope.parts.length > 1 ? <th className="py-2 text-start font-medium">{td("cols.branch")}</th> : null}
                    <th className="py-2 text-end font-medium">{td("cols.invoices")}</th>
                    <th className="py-2 text-end font-medium">{td("cols.amount")}</th>
                    <th className="py-2 text-end font-medium">{td("cols.days")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {families.slice(0, 10).map((f) => (
                    <tr key={f.id}>
                      <td className="py-2">
                        <span className="figure font-medium">{f.accountNo}</span>
                        <span className="block text-meta text-muted">{f.familyName}</span>
                      </td>
                      {scope.parts.length > 1 ? <td className="py-2">{branchName(scope.parts.find((b) => b.id === f.branchId)!)}</td> : null}
                      <td className="figure py-2 text-end">{n(f.invoices)}</td>
                      <td className="figure py-2 text-end whitespace-nowrap">{formatPiastres(BigInt(f.amount), loc, user.digits)}</td>
                      <td className="figure py-2 text-end">{n(f.days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canAsk ? (
              <form action={askToCall} className="mt-3 flex flex-col gap-2 border-t border-divider pt-3">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="branch" value={scope.current.id} />
                <p className="text-meta text-muted">
                  {limits ? td("askCallLimits", { days: n(limits.days), amount: formatPiastres(limits.amount, loc, user.digits) }) : null} {td("askCallHelp")}
                </p>
                <Button type="submit" variant="secondary" data-testid="ask-call">{td("askCall")}</Button>
              </form>
            ) : null}
          </Card>
        </>
      ) : null}

      {scope.parts.length > 1 ? (
        <Card data-testid="by-branch">
          <h2 className="text-section-title font-semibold">{td("byBranch")}</h2>
          <table className="mt-2 w-full text-[14px]">
            <thead>
              <tr className="text-meta text-muted">
                <th className="py-2 text-start font-medium">{td("cols.branch")}</th>
                <th className="py-2 text-end font-medium">{td("cols.value")}</th>
                {rows.some((r) => r.perChild !== null) ? <th className="py-2 text-end font-medium">{td("perChild")}</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {rows.map((r) => (
                <tr key={r.b.id}>
                  <td className="py-2">
                    <span className="flex flex-col items-start gap-1">
                      {branchName(r.b)}
                      {r.k ? <DataStatusChip status={r.k.status} /> : null}
                    </span>
                  </td>
                  <td className="py-2 text-end">{show(r.k, false)}</td>
                  {rows.some((x) => x.perChild !== null) ? (
                    <td className="py-2 text-end">
                      {r.perChild === null ? "—" : <span className="figure">{formatPiastres(r.perChild, loc, user.digits)}</span>}
                      {r.perChild !== null && r.perChild === maxPerChild ? (
                        <span className="ms-1">
                          <Flag tone="attention">{td("highest")}</Flag>
                        </span>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {trend.length ? (
        <Card data-testid="trend">
          <h2 className="text-section-title font-semibold">{def.trend === "month" ? td("trend12") : td("trend14")}</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {trend.map((x) => {
              const v = x.k?.value ? Math.abs(Number(x.k.value)) : 0;
              const width = trendMax > 0 ? Math.round((v * 100) / trendMax) : 0;
              const negative = x.k?.value?.startsWith("-");
              return (
                <li key={x.label} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-[13px]">
                  <span className="text-muted">{x.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="h-3 flex-1 overflow-hidden rounded-full bg-provisional-bg" aria-hidden="true">
                      <span className={`block h-full rounded-full ${negative ? "bg-critical" : "bg-chart-neutral"}`} style={{ inlineSize: `${width}%` }} />
                    </span>
                    <span className="min-w-20 text-end">{x.before ? <span className="text-muted">{td("beforeRecords")}</span> : show(x.k)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {classes.length ? (
        <Card data-testid="records-classes">
          <h2 className="text-section-title font-semibold">{td("classesToday")}</h2>
          <table className="mt-2 w-full text-[14px]">
            <thead>
              <tr className="text-meta text-muted">
                <th className="py-2 text-start font-medium">{td("cols.class")}</th>
                <th className="py-2 text-end font-medium">{td("cols.present")}</th>
                <th className="py-2 text-end font-medium">{td("cols.expected")}</th>
                <th className="py-2 text-end font-medium">{td("cols.marked")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {classes.flatMap(({ b, rows }) =>
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2">{scope.parts.length > 1 ? `${branchName(b)} · ` : ""}{loc === "ar" ? r.nameAr : r.nameEn}</td>
                    <td className="figure py-2 text-end">{r.marked ? n(r.present) : "—"}</td>
                    <td className="figure py-2 text-end">{r.marked ? n(r.expected) : "—"}</td>
                    <td className="figure py-2 text-end">
                      {r.marked < r.children ? <Flag tone="attention">{`${n(r.marked)}/${n(r.children)}`}</Flag> : `${n(r.marked)}/${n(r.children)}`}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </Card>
      ) : null}

      {id === "ratio_breaches" ? (
        <Card data-testid="records-breaches">
          <h2 className="text-section-title font-semibold">{td("breachesToday")}</h2>
          {breaches.every((x) => x.rows.length === 0) ? <p className="mt-2 text-[14px] text-subtle">{td("noBreaches")}</p> : null}
          <ul className="mt-2 flex flex-col divide-y divide-divider">
            {breaches.flatMap(({ b, rows }) =>
              rows.map((r) => (
                <li key={`${b.id}-${r.nameEn}`} className="flex flex-col gap-0.5 py-2 text-[14px]">
                  <span className="font-semibold">{scope.parts.length > 1 ? `${branchName(b)} · ` : ""}{loc === "ar" ? r.nameAr : r.nameEn}</span>
                  <span className="figure text-subtle">
                    {td("cols.children")} {n(r.children)} · {td("cols.carers")} {n(r.carers)} · {td("cols.required")} {n(r.required)} · {formatTimestamp(new Date(r.at), loc, user.digits)}
                  </span>
                </li>
              )),
            )}
          </ul>
        </Card>
      ) : null}

      {id === "actions_overdue" ? (
        <Card data-testid="records-overdue">
          <h2 className="text-section-title font-semibold">{td("overdueList")}</h2>
          {late.length === 0 ? <p className="mt-2 text-[14px] text-subtle">{td("nothingOverdue")}</p> : null}
          <ul className="mt-2 flex flex-col divide-y divide-divider">
            {late.map((o) => (
              <li key={`${o.kind}-${o.id}`}>
                <Link href={o.kind === "issue" ? `/issues/${o.id}` : `/incidents/${o.parentId}`} className="flex min-h-11 flex-col gap-0.5 py-2 text-[14px]">
                  <span className="font-semibold text-brand underline">{o.title}</span>
                  <span className="figure text-critical">{td("cols.due")}: {formatPlainDate(o.dueOn, loc, user.digits)} · {o.owner ?? "—"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-section-title font-semibold">{td("records")}</h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {links.map((l) => {
            const [key, b] = l.key.split("|");
            const branch = b ? scope.parts.find((x) => x.id === b) : null;
            return (
              <li key={l.key}>
                <Link href={l.href} className="inline-flex min-h-11 items-center rounded-button border border-outline bg-surface px-3 text-[14px] font-medium hover:bg-bg">
                  {td(`links.${key}` as "links.figures")}
                  {branch && scope.parts.length > 1 ? ` · ${branchName(branch)}` : ""}
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h2 className="text-section-title font-semibold">{td("formulaTitle")}</h2>
        <p className="mt-1 text-[14px] text-subtle">{td(`formula.${id}` as "formula.money_billed")}</p>
      </Card>
    </div>
  );
}
