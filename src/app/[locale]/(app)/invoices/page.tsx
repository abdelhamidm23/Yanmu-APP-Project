import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { accrueLateFees } from "@/db/billing";
import { requireMoney } from "@/lib/require-user";
import { FINANCE_VIEW_ROLES, canRunInvoices, hasRoleIn } from "@/lib/permissions";
import { daysOverdue } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, pickBranch } from "@/components/children/BranchTabs";
import { Amount, InvoiceStatus, MoneyResult, monthLabel } from "@/components/money/Money";

const VIEWS = ["open", "overdue", "late-today", "all"] as const;
type View = (typeof VIEWS)[number];

type InvoiceRow = {
  id: string; invoiceNo: string; kind: string; status: string; serviceMonth: string; dueDate: string;
  total: string; balance: string; accountNo: string; childAr: string | null; childEn: string | null; familyId: string;
};
type FamilyRow = { familyId: string; accountNo: string; displayName: string; invoices: number; amount: string; dueDate: string; today?: string };

/** Invoices of a branch: open, overdue families, late fees added today, or all (spec §8.4, §11.3). */
export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; view?: string; q?: string; ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "view");
  const t = await getTranslations("money.invoices");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "open";
  const q = (sp.q ?? "").trim();

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, FINANCE_VIEW_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    await accrueLateFees(tx, b.id, today);
    const like = `%${q}%`;
    if (view === "overdue" || view === "late-today") {
      const families = (await tx.execute(
        view === "overdue"
          ? sql`
            select f.id as "familyId", f.account_no as "accountNo", f.display_name as "displayName", count(*)::int as invoices,
              sum(i.total_piastres - i.paid_piastres - i.credited_piastres)::text as amount, to_char(min(i.due_date), 'YYYY-MM-DD') as "dueDate"
            from invoice i join family f on f.id = i.family_id
            where i.branch_id = ${b.id} and i.kind <> 'late_fee' and i.status <> 'paid' and i.due_date < ${today}
              and i.total_piastres - i.paid_piastres - i.credited_piastres > 0
            group by f.id order by min(i.due_date), f.account_no`
          : sql`
            select f.id as "familyId", f.account_no as "accountNo", f.display_name as "displayName", count(distinct i.id)::int as invoices,
              (select coalesce(sum(i2.total_piastres - i2.paid_piastres - i2.credited_piastres), 0) from invoice i2
                where i2.family_id = f.id and i2.kind = 'late_fee' and i2.status <> 'paid')::text as amount,
              to_char(min(i.due_date), 'YYYY-MM-DD') as "dueDate", sum(l.amount_piastres)::text as today
            from invoice_line l join invoice i on i.id = l.invoice_id join family f on f.id = i.family_id
            where i.branch_id = ${b.id} and l.accrual_date = ${today}
            group by f.id order by f.account_no`,
      )) as unknown as FamilyRow[];
      return { branches, b, families, invoices: [] as InvoiceRow[] };
    }
    const invoices = (await tx.execute(sql`
      select i.id, i.invoice_no as "invoiceNo", i.kind, i.status, to_char(i.service_month, 'YYYY-MM-DD') as "serviceMonth",
        to_char(i.due_date, 'YYYY-MM-DD') as "dueDate", i.total_piastres::text as total,
        (i.total_piastres - i.paid_piastres - i.credited_piastres)::text as balance,
        f.account_no as "accountNo", f.id as "familyId", s.full_name_ar as "childAr", s.full_name_en as "childEn"
      from invoice i join family f on f.id = i.family_id left join student s on s.id = i.student_id
      where i.branch_id = ${b.id}
        and (${view} = 'all' or i.status <> 'paid')
        and (${q} = '' or i.invoice_no ilike ${like} or f.account_no ilike ${like} or f.display_name ilike ${like}
             or s.full_name_ar ilike ${like} or s.full_name_en ilike ${like})
      order by i.service_month desc, i.due_date, i.invoice_no
      limit 300`)) as unknown as InvoiceRow[];
    return { branches, b, families: [] as FamilyRow[], invoices };
  });
  if (!data) return <Card>{tm("noBranch")}</Card>;
  const { branches, b, families, invoices } = data;
  const n = (v: number) => formatNumber(v, loc, user.digits);
  const base = `/invoices?branch=${b.id}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")}>
        {canRunInvoices(user, b.id) ? (
          <Link href={`/invoices/run?branch=${b.id}`} className={buttonClasses("primary")} data-testid="open-run">
            {tm("links.invoiceRun")}
          </Link>
        ) : null}
      </PageHeader>
      <BranchTabs branches={branches} current={b.id} path="/invoices" locale={locale} label={tm("branch")} />
      <MoneyResult searchParams={sp} />
      <nav className="flex flex-wrap gap-2" aria-label={t("views")}>
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={`${base}&view=${v}`}
            aria-current={v === view ? "page" : undefined}
            data-testid={`view-${v}`}
            className={`inline-flex min-h-11 items-center rounded-button px-4 text-[14px] font-medium ${v === view ? "bg-brand text-white" : "border border-outline bg-surface"}`}
          >
            {t(`view.${v}`)}
          </Link>
        ))}
        <a href={`/api/export/invoices?branch=${b.id}&view=${view}&locale=${loc}`} className="ms-auto self-center text-brand underline" data-testid="export-invoices">
          {tm("export")}
        </a>
      </nav>

      {view === "open" || view === "all" ? (
        <form className="flex gap-2" action="/invoices" method="get">
          <input type="hidden" name="branch" value={b.id} />
          <input type="hidden" name="view" value={view} />
          <label htmlFor="inv-q" className="sr-only">{t("search")}</label>
          <input id="inv-q" name="q" defaultValue={q} placeholder={t("search")} className="min-h-11 flex-1 rounded-button border border-outline bg-surface px-3" />
          <button type="submit" className={buttonClasses("secondary")}>{t("find")}</button>
        </form>
      ) : null}

      {view === "overdue" || view === "late-today" ? (
        <>
          <p className="text-meta text-muted">{t(view === "overdue" ? "overdueHelp" : "lateTodayHelp")}</p>
          {families.length === 0 ? <Card>{t(view === "overdue" ? "noneOverdue" : "noneLateToday")}</Card> : null}
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="family-rows">
            {families.map((f) => (
              <li key={f.familyId}>
                <Link href={`/payment?branch=${b.id}&family=${f.familyId}`} className="flex min-h-14 flex-col gap-1 px-4 py-3 hover:bg-bg">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-row-title font-semibold">{f.accountNo} · {f.displayName}</span>
                    <Amount value={BigInt(f.amount)} locale={locale} digits={user.digits} className="font-semibold" />
                  </span>
                  <span className="text-meta text-subtle">
                    {view === "overdue"
                      ? t("overdueRow", { n: n(f.invoices), days: n(daysOverdue(f.dueDate, today)) })
                      : t("lateTodayRow")}
                    {f.today ? <> · <Amount value={BigInt(f.today)} locale={locale} digits={user.digits} /></> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {invoices.length === 0 ? <Card>{t("empty")}</Card> : null}
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="invoice-rows">
            {invoices.map((i) => (
              <li key={i.id}>
                <Link href={`/invoices/${i.id}`} className="flex min-h-14 flex-col gap-1 px-4 py-3 hover:bg-bg">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-row-title font-semibold">{(locale === "ar" ? i.childAr : i.childEn) ?? t("family")} · {i.accountNo}</span>
                    <Amount value={BigInt(i.balance)} locale={locale} digits={user.digits} className="font-semibold" />
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-meta text-subtle">
                    <span className="figure">{i.invoiceNo}</span> · {tm(`kinds.${i.kind}`)} · {monthLabel(i.serviceMonth, locale, user.digits)}
                    <InvoiceStatus status={i.status} overdue={i.status !== "paid" && i.dueDate < today} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
