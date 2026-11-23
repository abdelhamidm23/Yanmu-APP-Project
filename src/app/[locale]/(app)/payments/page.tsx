import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { cairoDayStart } from "@/db/money";
import { requireMoney } from "@/lib/require-user";
import { FINANCE_VIEW_ROLES, canRecordPayment, hasRoleIn } from "@/lib/permissions";
import { PAYMENT_METHODS } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber, formatPlainDate, formatTimestamp } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";
import { Amount, MoneyResult } from "@/components/money/Money";

type Row = { id: string; receiptNo: string; receivedAt: Date; method: string; amount: string; voidedAt: Date | null; accountNo: string; displayName: string; byName: string | null };

/** Payments received on a day, with totals by method (spec §8.4.3). */
export default async function PaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; date?: string; ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "view");
  const t = await getTranslations("money.payments");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, FINANCE_VIEW_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const from = cairoDayStart(date);
    const to = new Date(from.getTime() + 86_400_000);
    const rows = (await tx.execute(sql`
      select p.id, p.receipt_no as "receiptNo", p.received_at as "receivedAt", p.method, p.amount_piastres::text as amount,
        p.voided_at as "voidedAt", f.account_no as "accountNo", f.display_name as "displayName", u.full_name as "byName"
      from payment p join family f on f.id = p.family_id left join app_user u on u.id = p.created_by
      where p.branch_id = ${b.id} and p.received_at >= ${from.toISOString()} and p.received_at < ${to.toISOString()}
      order by p.received_at desc`)) as unknown as Row[];
    return { branches, b, rows };
  });
  if (!data) return <Card>{tm("noBranch")}</Card>;
  const { branches, b, rows } = data;
  const live = rows.filter((r) => !r.voidedAt);
  const total = live.reduce((s, r) => s + BigInt(r.amount), 0n);
  const byMethod = PAYMENT_METHODS.map((m) => ({ m, v: live.filter((r) => r.method === m).reduce((s, r) => s + BigInt(r.amount), 0n) })).filter((x) => x.v > 0n);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")}>
        {canRecordPayment(user, b.id) ? (
          <Link href={`/payment?branch=${b.id}`} className={buttonClasses("primary")}>{tm("links.recordPayment")}</Link>
        ) : null}
      </PageHeader>
      <BranchTabs branches={branches} current={b.id} path="/payments" locale={locale} label={tm("branch")} />
      <MoneyResult searchParams={sp} />
      <form className="flex flex-wrap items-end gap-2" action={`/${locale}/payments`} method="get">
        <input type="hidden" name="branch" value={b.id} />
        <div className="flex flex-col gap-1">
          <label htmlFor="pay-date" className="text-[13px] font-medium text-subtle">{t("date")}</label>
          <input id="pay-date" type="date" name="date" defaultValue={date} max={today} className="min-h-11 rounded-button border border-outline bg-surface px-3" />
        </div>
        <button type="submit" className={buttonClasses("secondary")}>{t("show")}</button>
        <a href={`/api/export/payments?locale=${locale}&branch=${b.id}&date=${date}`} className={buttonClasses("secondary")}>{tm("export")}</a>
      </form>
      <Card>
        <p className="text-meta text-muted">{formatPlainDate(date, loc, user.digits)}</p>
        <p className="text-kpi font-semibold" data-testid="payments-total"><Amount locale={locale} digits={user.digits} value={total} /></p>
        <p className="text-[14px] text-subtle">{t("count", { n: formatNumber(live.length, loc, user.digits) })}</p>
        {byMethod.length ? (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
            {byMethod.map(({ m, v }) => (
              <li key={m}>{tm(`methods.${m}`)}: <Amount locale={locale} digits={user.digits} value={v} /></li>
            ))}
          </ul>
        ) : null}
      </Card>
      {rows.length === 0 ? <Card>{t("empty")}</Card> : null}
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/payments/${r.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-bg">
              <span className="flex flex-col">
                <span className="font-semibold"><span className="figure">{r.receiptNo}</span> · {r.accountNo} · {r.displayName}</span>
                <span className="text-meta text-muted">{formatTimestamp(new Date(r.receivedAt), loc, user.digits)} · {tm(`methods.${r.method}`)} · {r.byName ?? "—"}</span>
              </span>
              {r.voidedAt ? <Flag tone="critical">{tm("voided")}</Flag> : <Amount locale={locale} digits={user.digits} value={BigInt(r.amount)} />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
