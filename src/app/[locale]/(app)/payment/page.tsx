import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { accrueLateFees, familyCredit, familyOpenInvoices } from "@/db/billing";
import { findFamilies } from "@/db/money";
import { requireMoney } from "@/lib/require-user";
import { FINANCE_VIEW_ROLES, canRecordPayment, hasRoleIn } from "@/lib/permissions";
import { PAYMENT_METHODS, allocate, daysOverdue } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber, formatPiastres, formatTimestamp } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";
import { Amount, MoneyResult, monthLabel } from "@/components/money/Money";
import { recordPaymentAction } from "./actions";

/** "+ Payment" (spec §8.4.3, §11.1): find the family, see what it owes, record the payment. Also the family's statement. */
export default async function PaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; family?: string; q?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "view");
  const t = await getTranslations("money.payment");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();
  const familyId = sp.family && /^[0-9a-f-]{36}$/.test(sp.family) ? sp.family : null;

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, FINANCE_VIEW_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    if (!familyId) return { branches, b, results: await findFamilies(tx, b.id, sp.q ?? ""), fam: null };
    await accrueLateFees(tx, b.id, today);
    const [fam] = (await tx.execute(sql`
      select f.id, f.account_no as "accountNo", f.display_name as "displayName",
        coalesce(string_agg(s.full_name_ar, '، ' order by s.full_name_ar), '') as "childrenAr",
        coalesce(string_agg(s.full_name_en, ', ' order by s.full_name_en), '') as "childrenEn"
      from family f left join student s on s.family_id = f.id
      where f.id = ${familyId} and f.branch_id = ${b.id} group by f.id`)) as unknown as {
      id: string; accountNo: string; displayName: string; childrenAr: string; childrenEn: string;
    }[];
    if (!fam) return { branches, b, results: [], fam: null };
    const open = await familyOpenInvoices(tx, familyId);
    const credit = (await familyCredit(tx, familyId)).reduce((s, c) => s + c.left, 0n);
    const recent = (await tx.execute(sql`
      select id, receipt_no as "receiptNo", received_at as "receivedAt", amount_piastres::text as amount, method, voided_at as "voidedAt"
      from payment where family_id = ${familyId} order by received_at desc limit 10`)) as unknown as {
      id: string; receiptNo: string; receivedAt: Date; amount: string; method: string; voidedAt: Date | null;
    }[];
    const names = (await tx.execute(sql`select id, full_name_ar as "ar", full_name_en as "en" from student where family_id = ${familyId}`)) as unknown as {
      id: string; ar: string; en: string;
    }[];
    return { branches, b, results: [], fam: { ...fam, open, credit, recent, names } };
  });
  if (!data) return <Card>{tm("noBranch")}</Card>;
  const { branches, b, results, fam } = data;
  const n = (v: number) => formatNumber(v, loc, user.digits);
  const canPay = canRecordPayment(user, b.id);

  if (!fam) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={canPay ? t("title") : t("statementTitle")} help={t("findHelp")} />
        <BranchTabs branches={branches} current={b.id} path="/payment" locale={locale} label={tm("branch")} />
        <MoneyResult searchParams={sp} />
        <form className="flex gap-2" action={`/${locale}/payment`} method="get" role="search">
          <input type="hidden" name="branch" value={b.id} />
          <label htmlFor="family-q" className="sr-only">{t("search")}</label>
          <input id="family-q" name="q" defaultValue={sp.q ?? ""} placeholder={t("search")} className="min-h-11 flex-1 rounded-button border border-outline bg-surface px-3" data-testid="family-search" />
          <button type="submit" className={buttonClasses("secondary")}>{t("find")}</button>
        </form>
        {results.length === 0 ? <Card>{t("noFamilies")}</Card> : null}
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="family-results">
          {results.map((f) => (
            <li key={f.id}>
              <Link href={`/payment?branch=${b.id}&family=${f.id}`} className="flex min-h-14 flex-col gap-1 px-4 py-3 hover:bg-bg">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-row-title font-semibold">{f.accountNo} · {f.displayName}</span>
                  {BigInt(f.owed) > 0n ? <Amount locale={locale} digits={user.digits} value={BigInt(f.owed)} className="font-semibold" /> : <Flag tone="good">{t("nothingOwed")}</Flag>}
                </span>
                <span className="text-meta text-subtle">{locale === "ar" ? f.childrenAr : f.childrenEn}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const owed = fam.open.reduce((s, i) => s + i.balance, 0n);
  const plan = allocate(owed, fam.open.map((i) => ({ id: i.id, kind: i.kind as "tuition", dueDate: i.dueDate, balance: i.balance })));
  const order = new Map(plan.allocations.map((a, i) => [a.invoiceId, i]));
  const childName = new Map(fam.names.map((c) => [c.id, locale === "ar" ? c.ar : c.en]));
  const sorted = [...fam.open].sort((x, y) => (order.get(x.id) ?? 99) - (order.get(y.id) ?? 99));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${fam.accountNo} · ${fam.displayName}`} help={locale === "ar" ? fam.childrenAr : fam.childrenEn}>
        <Link href={`/payment?branch=${b.id}`} className="text-brand underline">{t("otherFamily")}</Link>
      </PageHeader>
      <MoneyResult searchParams={sp} />
      <Card data-testid="family-owes">
        <h2 className="text-section-title font-semibold">{t("owes")}</h2>
        <p className="mt-1 text-kpi font-semibold" data-testid="family-owed"><Amount locale={locale} digits={user.digits} value={owed} /></p>
        {fam.credit > 0n ? <p className="text-[14px]">{t("credit")}: <Amount locale={locale} digits={user.digits} value={fam.credit} /></p> : null}
        <ul className="mt-3 flex flex-col divide-y divide-divider">
          {sorted.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
              <Link href={`/invoices/${i.id}`} className="text-brand underline">
                {tm(`kinds.${i.kind}`)} · {monthLabel(i.serviceMonth, locale, user.digits)}
                {i.studentId ? ` · ${childName.get(i.studentId) ?? ""}` : ""}
              </Link>
              <span className="flex items-center gap-2">
                {i.dueDate < today ? <Flag tone="critical">{t("daysLate", { n: n(daysOverdue(i.dueDate, today)) })}</Flag> : null}
                <Amount locale={locale} digits={user.digits} value={i.balance} />
              </span>
            </li>
          ))}
        </ul>
        {fam.open.length === 0 ? <p className="mt-2 text-muted">{t("nothingOwed")}</p> : null}
      </Card>

      {canPay ? (
        <Card>
          <h2 className="text-section-title font-semibold">{t("record")}</h2>
          <form action={recordPaymentAction} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="payment-form">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="branchId" value={b.id} />
            <input type="hidden" name="familyId" value={fam.id} />
            <Field
              id="pay-amount"
              name="amount"
              label={t("amount")}
              inputMode="decimal"
              required
              defaultValue={owed > 0n ? formatPiastres(owed, "en", "latin").replace(/,/g, "") : ""}
              hint={t("amountHint")}
            />
            <SelectField id="pay-method" name="method" label={t("method")} options={PAYMENT_METHODS.map((m) => ({ value: m, label: tm(`methods.${m}`) }))} />
            <div className="sm:col-span-2">
              <Field id="pay-ref" name="reference" label={t("reference")} maxLength={80} hint={t("referenceHint")} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" full data-testid="record-payment">{t("save")}</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-section-title font-semibold">{t("recent")}</h2>
        {fam.recent.length === 0 ? <p className="mt-2 text-muted">{t("noPayments")}</p> : null}
        <ul className="mt-2 flex flex-col divide-y divide-divider">
          {fam.recent.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
              <Link href={`/payments/${p.id}`} className="text-brand underline"><span className="figure">{p.receiptNo}</span></Link>
              <span className="text-meta text-muted">{formatTimestamp(new Date(p.receivedAt), loc, user.digits)} · {tm(`methods.${p.method}`)}</span>
              {p.voidedAt ? <Flag tone="critical">{tm("voided")}</Flag> : <Amount locale={locale} digits={user.digits} value={BigInt(p.amount)} />}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
