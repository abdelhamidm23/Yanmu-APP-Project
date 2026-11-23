import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { accrueLateFees } from "@/db/billing";
import { moneySummary } from "@/db/money";
import { requireMoney } from "@/lib/require-user";
import {
  FINANCE_VIEW_ROLES,
  canDecideMoney,
  canEditFees,
  canRecordPayment,
  canRunInvoices,
  canUseCashBox,
  canViewExpenses,
  canReconcileCash,
  canRequestCredit,
  canRecordExpense,
  hasRoleIn,
} from "@/lib/permissions";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { StatusChip } from "@/components/ui/StatusChip";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, pickBranch } from "@/components/children/BranchTabs";
import { Amount, MoneyResult, monthLabel } from "@/components/money/Money";

/** Money overview for one branch (spec §9.1): billed, collected, overdue, late fees, today. Accountant's first tab. */
export default async function MoneyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "view");
  const t = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, FINANCE_VIEW_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    await accrueLateFees(tx, b.id, today);
    return { branches, b, s: await moneySummary(tx, b.id, today) };
  });
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("title")} />
        <Card>{t("noBranch")}</Card>
      </div>
    );
  }
  const { branches, b, s } = data;
  const q = `branch=${b.id}`;
  const n = (v: number) => formatNumber(v, loc, user.digits);

  const links = [
    { show: canRecordPayment(user, b.id), href: `/payment?${q}`, key: "recordPayment", primary: true },
    { show: true, href: `/invoices?${q}`, key: "invoices" },
    { show: canRunInvoices(user, b.id), href: `/invoices/run?${q}`, key: "invoiceRun" },
    { show: true, href: `/payments?${q}`, key: "payments" },
    { show: canUseCashBox(user, b.id) || canReconcileCash(user, b.id) || canDecideMoney(user, b.id), href: `/cash-box?${q}`, key: "cashBox" },
    { show: canViewExpenses(user, b.id), href: `/expenses?${q}`, key: "expenses" },
    { show: canDecideMoney(user, b.id) || canRequestCredit(user, b.id) || canRecordExpense(user, b.id), href: `/inbox`, key: "approvals" },
    { show: true, href: `/settings/price-locks?${q}`, key: "priceLocks" },
    { show: canEditFees(user, b.id), href: `/settings/fees?${q}`, key: "fees" },
  ].filter((l) => l.show);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")} />
      <BranchTabs branches={branches} current={b.id} path="/money" locale={locale} label={t("branch")} />
      <MoneyResult searchParams={sp} />

      <Card data-testid="money-month">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-section-title font-semibold">{monthLabel(s.month, locale, user.digits)}</h2>
          <StatusChip status="provisional" label={t("provisional")} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <dt className="text-meta text-muted">{t("billed")}</dt>
            <dd className="text-kpi font-semibold" data-testid="money-billed">
              {s.invoicesThisMonth === 0 ? "—" : <Amount locale={locale} digits={user.digits} value={s.billed} />}
            </dd>
            <dd className="text-meta text-muted">{s.invoicesThisMonth === 0 ? t("notIssued") : t("invoicesCount", { n: n(s.invoicesThisMonth) })}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-meta text-muted">{t("collected")}</dt>
            <dd className="text-kpi font-semibold" data-testid="money-collected">
              <Amount locale={locale} digits={user.digits} value={s.collected.total} />
            </dd>
            <dd className="text-meta text-muted">{t("paymentsCount", { n: n(s.collected.count) })}</dd>
          </div>
        </dl>
        <ul className="mt-3 flex flex-col gap-1 text-[14px]">
          <li className="flex justify-between gap-2"><span>{t("split.tuition")}</span><Amount locale={locale} digits={user.digits} value={s.collected.tuition} /></li>
          <li className="flex justify-between gap-2"><span>{t("split.lateFees")}</span><Amount locale={locale} digits={user.digits} value={s.collected.lateFees} /></li>
          {s.collected.other > 0n ? <li className="flex justify-between gap-2"><span>{t("split.other")}</span><Amount locale={locale} digits={user.digits} value={s.collected.other} /></li> : null}
          {s.collected.onAccount > 0n ? <li className="flex justify-between gap-2"><span>{t("split.onAccount")}</span><Amount locale={locale} digits={user.digits} value={s.collected.onAccount} /></li> : null}
        </ul>
        <p className="mt-2 text-meta text-muted">{t("billedNote")}</p>
      </Card>

      <Card data-testid="money-overdue">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-section-title font-semibold">{t("overdueTitle")}</h2>
          <Link href={`/invoices?${q}&view=overdue`} className="text-brand underline">{t("seeFamilies")}</Link>
        </div>
        <p className="mt-2 text-kpi font-semibold"><Amount locale={locale} digits={user.digits} value={s.overdue.total} /></p>
        <p className="text-meta text-muted">{t("familiesCount", { n: n(s.overdue.families) })}</p>
        <ul className="mt-3 grid grid-cols-3 gap-2 text-center">
          {(["d1_30", "d31_60", "d60_plus"] as const).map((k) => (
            <li key={k} className="flex flex-col gap-1 rounded-button bg-bg p-2">
              <span className="text-meta text-muted">{t(`ageing.${k}`)}</span>
              <Amount locale={locale} digits={user.digits} value={s.overdue.buckets[k]} className="text-[14px] font-semibold" />
            </li>
          ))}
        </ul>
      </Card>

      <Card data-testid="money-late-fees">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-section-title font-semibold">{t("lateFeesTitle")}</h2>
          <Link href={`/invoices?${q}&view=late-today`} className="text-brand underline" data-testid="late-today-link">{t("lateToday")}</Link>
        </div>
        <p className="mt-2 text-[15px]">{t("lateOutstanding")}: <Amount locale={locale} digits={user.digits} value={s.lateFees.outstanding} className="font-semibold" /> · {t("familiesCount", { n: n(s.lateFees.families) })}</p>
        <p className="text-[15px]">{t("lateAddedToday")}: <Amount locale={locale} digits={user.digits} value={s.lateFees.today} className="font-semibold" /> · {t("familiesCount", { n: n(s.lateFees.todayFamilies) })}</p>
        <p className="mt-2 text-meta text-muted">{t("lateNote")}</p>
      </Card>

      <Card>
        <h2 className="text-section-title font-semibold">{t("todayTitle")}</h2>
        <p className="mt-2 text-[15px]">{t("paymentsToday", { n: n(s.paymentsToday.count) })}: <Amount locale={locale} digits={user.digits} value={s.paymentsToday.total} className="font-semibold" /></p>
        <p className="text-[15px]">{t(`cashState.${s.cashBox}`)}</p>
        {s.approvalsWaiting > 0 ? <p className="text-[15px]">{t("approvalsWaiting", { n: n(s.approvalsWaiting) })}</p> : null}
      </Card>

      <nav aria-label={t("actions")} className="grid grid-cols-2 gap-2" data-testid="money-links">
        {links.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            data-testid={`money-${l.key}`}
            className={`flex min-h-12 items-center justify-center rounded-button px-3 text-center text-[14px] font-semibold ${
              l.primary ? "bg-brand text-white hover:bg-brand-hover" : "border border-outline bg-surface text-ink hover:bg-bg"
            }`}
          >
            {t(`links.${l.key}`)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
