import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { requireMoney } from "@/lib/require-user";
import { EXPENSE_VIEW_ROLES, canRecordExpense, hasRoleIn } from "@/lib/permissions";
import { monthEnd, monthStart } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";
import { formatPlainDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, pickBranch } from "@/components/children/BranchTabs";
import { Amount, ExpenseStatus, MoneyResult, monthLabel } from "@/components/money/Money";

type Row = {
  id: string; spentOn: string; amount: string; status: string; isRequest: boolean; description: string; categoryAr: string; categoryEn: string;
  vendor: string | null; method: string; byName: string | null; reverses: string | null; isDemo: boolean;
};

/** Expenses of a month for a branch, with totals by category (spec §8.6). */
export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; month?: string; ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "expenses");
  const t = await getTranslations("money.expenses");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? `${sp.month}-01` : monthStart(today);

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, EXPENSE_VIEW_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const rows = (await tx.execute(sql`
      select e.id, to_char(e.spent_on, 'YYYY-MM-DD') as "spentOn", e.amount_piastres::text as amount, e.status, e.is_request as "isRequest",
        e.description, c.name_ar as "categoryAr", c.name_en as "categoryEn", v.name as vendor, e.payment_method as method,
        u.full_name as "byName", e.reverses_expense_id as reverses, e.is_demo as "isDemo"
      from expense e join expense_category c on c.id = e.category_id left join vendor v on v.id = e.vendor_id
      left join app_user u on u.id = e.created_by
      where e.branch_id = ${b.id} and ((e.spent_on between ${month} and ${monthEnd(month)}) or (e.is_request and e.status in ('pending_approval', 'approved')))
      order by e.spent_on desc, e.created_at desc`)) as unknown as Row[];
    return { branches, b, rows };
  });
  if (!data) return <Card>{tm("noBranch")}</Card>;
  const { branches, b, rows } = data;
  const counted = rows.filter((r) => !r.isRequest && ["recorded", "approved", "reversed"].includes(r.status));
  const total = counted.reduce((s, r) => s + BigInt(r.amount), 0n);
  const byCat = new Map<string, bigint>();
  for (const r of counted) {
    const k = loc === "ar" ? r.categoryAr : r.categoryEn;
    byCat.set(k, (byCat.get(k) ?? 0n) + BigInt(r.amount));
  }
  const waiting = rows.filter((r) => r.status === "pending_approval");
  const prev = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")}>
        {canRecordExpense(user, b.id) ? <Link href={`/expenses/new?branch=${b.id}`} className={buttonClasses("primary")}>{t("add")}</Link> : null}
      </PageHeader>
      <BranchTabs branches={branches} current={b.id} path="/expenses" locale={locale} label={tm("branch")} />
      <MoneyResult searchParams={sp} />
      <nav className="flex items-center justify-between gap-2" aria-label={t("month")}>
        <Link href={`/expenses?branch=${b.id}&month=${prev}`} className={buttonClasses("secondary")}>{t("prev")}</Link>
        <span className="font-semibold">{monthLabel(month, locale, user.digits)}</span>
        {month < monthStart(today) ? <Link href={`/expenses?branch=${b.id}&month=${next}`} className={buttonClasses("secondary")}>{t("next")}</Link> : <span />}
      </nav>
      <Card>
        <p className="text-meta text-muted">{t("total")}</p>
        <p className="text-kpi font-semibold" data-testid="expenses-total"><Amount locale={locale} digits={user.digits} value={total} /></p>
        {waiting.length ? <p className="text-[14px] text-subtle">{t("waiting", { n: waiting.length })}</p> : null}
        {byCat.size ? (
          <ul className="mt-2 flex flex-col gap-1 text-[14px]">
            {[...byCat.entries()].sort((x, y) => (y[1] > x[1] ? 1 : -1)).map(([k, v]) => (
              <li key={k} className="flex justify-between gap-2"><span>{k}</span><Amount locale={locale} digits={user.digits} value={v} /></li>
            ))}
          </ul>
        ) : null}
        <a href={`/api/export/expenses?locale=${locale}&branch=${b.id}&month=${month.slice(0, 7)}`} className={`${buttonClasses("secondary")} mt-3`}>{tm("export")}</a>
      </Card>
      {rows.length === 0 ? <Card>{t("empty")}</Card> : null}
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/expenses/${r.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-bg">
              <span className="flex flex-col">
                <span className="font-semibold">{loc === "ar" ? r.categoryAr : r.categoryEn} · {r.description}</span>
                <span className="text-meta text-muted">
                  {formatPlainDate(r.spentOn, loc, user.digits)} · {tm(`methods.${r.method}`)}{r.vendor ? ` · ${r.vendor}` : ""} · {r.byName ?? "—"}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <ExpenseStatus status={r.status} isRequest={r.isRequest} reversal={!!r.reverses} />
                <Amount locale={locale} digits={user.digits} value={BigInt(r.amount)} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
