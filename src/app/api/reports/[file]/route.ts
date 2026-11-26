import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { homeScope, combine } from "@/db/home-view";
import { appExpenses, attentionItems, centralCosts, kpisByBranch, monthEnd, overdueFamilies } from "@/db/home";
import { getCurrentUser } from "@/lib/session";
import { canOpenSection } from "@/lib/roles";
import { todayInCairo } from "@/lib/calendar";
import { formatPiastres } from "@/lib/format";
import { KPI_DEFS, type Kpi } from "@/lib/data-status";
import { COMPARISON_METRICS, branchMetrics, rankAttention } from "@/lib/home";
import { buildBook, buildWorkbook, xlsxResponse } from "@/lib/excel";

const notFound = () => new Response("Not found", { status: 404 });
/** Piastres as an EGP number for Excel cells (exact to the piastre: two decimals at most). */
const egp = (v: bigint) => Number(formatPiastres(v, "en", "latin").replace(/,/g, "").replace("−", "-"));
const statusKey = (s: string) => (s === "notSubmitted" ? "notSubmitted" : s);

/**
 * Owner reports (spec §11.1 "Reports", rule 13): the overdue families list and the monthly report with every
 * figure and its status, the branch comparison and what needs attention. Owner and company manager only;
 * row-level security limits every row.
 */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") === "en" ? "en" : "ar";
  const user = await getCurrentUser();
  if (!user || user.mustSetUpMfa || !user.activeRole || !canOpenSection(user.activeRole, "home")) return notFound();
  const t = await getTranslations({ locale });
  const today = todayInCairo();

  if (file === "overdue") {
    const out = await withUserDb(user.id, async (tx) => {
      const scope = await homeScope(tx, user, url.searchParams.get("branch") ?? "all", { ar: "", en: "" });
      if (!scope || !scope.money) return null;
      const rows = [];
      for (const b of scope.parts)
        for (const f of await overdueFamilies(tx, b.id, today))
          rows.push([f.accountNo, f.familyName, locale === "ar" ? b.nameAr : b.nameEn, f.invoices, egp(BigInt(f.amount)), f.days, String(f.since).slice(0, 10)]);
      return rows;
    });
    if (!out) return notFound();
    const c = (k: string) => ({ header: t(`home.detail.cols.${k}` as "home.detail.cols.account") });
    const body = await buildWorkbook(
      t("home.tiles.money_overdue"),
      [c("account"), c("family"), c("branch"), c("invoices"), c("amount"), c("days"), { header: t("home.reports.cols.since") }],
      out as (string | number)[][],
      locale,
    );
    return xlsxResponse(body, `overdue-families-${today}.xlsx`);
  }

  if (file === "monthly") {
    const month = `${z.string().regex(/^\d{4}-\d{2}$/).catch(today.slice(0, 7)).parse(url.searchParams.get("month") ?? today.slice(0, 7))}-01`;
    if (month > `${today.slice(0, 7)}-01`) return notFound();
    const date = month === `${today.slice(0, 7)}-01` ? today : monthEnd(month);
    const data = await withUserDb(user.id, async (tx) => {
      const scope = await homeScope(tx, user, "all", { ar: t("closing.allBranches"), en: t("closing.allBranches") });
      if (!scope) return null;
      const ids = scope.parts.map((b) => b.id);
      const per = await kpisByBranch(tx, ids, date);
      const compare = scope.money
        ? await Promise.all(
            scope.parts.map(async (b) => {
              const ks = per.get(b.id)!;
              const v = (k: string) => ks.find((x) => x.key === k)?.value ?? "0";
              const int = (s: string) => BigInt(s.split(".")[0]);
              const costs = await centralCosts(tx, b.id, month);
              return {
                b,
                m: branchMetrics({
                  branchId: b.id, active: Number(int(v("children.active"))), licensed: b.licensed ?? 0,
                  monthClosed: ks.find((x) => x.key === "money.billed")?.status === "verified", billed: int(v("money.billed")),
                  appExpenses: await appExpenses(tx, b.id, month, date), central: costs.central, salaries: costs.salaries,
                  collectionRate: ks.find((x) => x.key === "money.collection_rate")?.value ?? null,
                  incidents: Number(int(v("incidents.month"))), overdue: int(v("money.overdue")),
                }),
              };
            }),
          )
        : [];
      const attention = rankAttention(await attentionItems(tx, user, scope.parts, today));
      return { scope, per, all: scope.parts.length > 1 ? combine(per, ids) : null, compare, attention };
    });
    if (!data) return notFound();
    const { scope, per, all, compare, attention } = data;
    const nameOf = (b: { nameAr: string; nameEn: string }) => (locale === "ar" ? b.nameAr : b.nameEn);
    const value = (k: Kpi) => (k.value === null ? "—" : k.kind === "piastres" ? egp(BigInt(k.value.split(".")[0])) : Number(k.value));
    const figureRows: (string | number | null)[][] = [];
    const add = (label: string, ks: Kpi[]) => {
      for (const d of KPI_DEFS) {
        const k = ks.find((x) => x.key === d.key);
        if (!k) continue;
        figureRows.push([
          label,
          t(`closing.figures.kpis.${d.key.replace(/\./g, "_")}` as "closing.figures.kpis.children_active"),
          value(k),
          t(`status.${statusKey(k.status)}` as "status.verified"),
          k.done !== null && k.total !== null ? `${k.done}/${k.total}` : "",
        ]);
      }
    };
    if (all) add(t("closing.allBranches"), all);
    for (const b of scope.parts) add(nameOf(b), per.get(b.id)!);
    const rc = (k: string) => ({ header: t(`home.reports.cols.${k}` as "home.reports.cols.branch") });
    const sheets = [
      { title: t("home.reports.sheets.summary"), columns: [rc("branch"), rc("figure"), rc("value"), rc("status"), rc("coverage")], rows: figureRows },
    ];
    if (compare.length)
      sheets.push({
        title: t("home.reports.sheets.compare"),
        columns: [rc("figure"), ...compare.map((c) => ({ header: nameOf(c.b) }))],
        rows: COMPARISON_METRICS.map((m) => [
          t(`home.compare.metrics.${m.key}.label`),
          ...compare.map((c) => {
            const v = c.m[m.key];
            return v === null ? "—" : typeof v === "bigint" ? egp(v) : Number(v);
          }),
        ]),
      });
    sheets.push({
      title: t("home.reports.sheets.attention"),
      columns: [rc("kind"), rc("branch"), rc("item"), rc("since")],
      rows: attention.map((a) => {
        const b = scope.parts.find((x) => x.id === a.branchId);
        const v = a.values;
        const item = v.account ? `${v.account} · ${v.family}` : v.categoryEn ? String(locale === "ar" ? v.categoryAr : v.categoryEn) : v.date ? String(v.date) : "";
        return [t(`home.kinds.${a.kind}.chip` as "home.kinds.approval.chip"), b ? nameOf(b) : "", item, a.at.slice(0, 10)];
      }),
    });
    return xlsxResponse(await buildBook(sheets, locale), `monthly-report-${month.slice(0, 7)}.xlsx`);
  }
  return notFound();
}
