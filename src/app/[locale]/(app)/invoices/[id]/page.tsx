import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { requireMoney } from "@/lib/require-user";
import { canRecordPayment, canRequestCredit } from "@/lib/permissions";
import { PAYMENT_METHODS, proratedDays } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber, formatPlainDate, formatTimestamp } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { Flag } from "@/components/children/BranchTabs";
import { Amount, InvoiceStatus, MoneyResult, monthLabel } from "@/components/money/Money";
import { payRefund, requestCredit } from "./actions";

type Inv = {
  id: string; branchId: string; invoiceNo: string; kind: string; status: string; serviceMonth: string; issueDate: string; dueDate: string;
  total: string; paid: string; credited: string; familyId: string; accountNo: string; familyName: string; childAr: string | null; childEn: string | null;
};

/** One invoice: lines, payments, credit notes and what is still owed (spec §8.4). */
export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ok?: string; done?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "view");
  const t = await getTranslations("money.invoice");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const data = await withUserDb(user.id, async (tx) => {
    const [inv] = (await tx.execute(sql`
      select i.id, i.branch_id as "branchId", i.invoice_no as "invoiceNo", i.kind, i.status,
        to_char(i.service_month, 'YYYY-MM-DD') as "serviceMonth", to_char(i.issue_date, 'YYYY-MM-DD') as "issueDate",
        to_char(i.due_date, 'YYYY-MM-DD') as "dueDate", i.total_piastres::text as total, i.paid_piastres::text as paid,
        i.credited_piastres::text as credited, f.id as "familyId", f.account_no as "accountNo", f.display_name as "familyName",
        s.full_name_ar as "childAr", s.full_name_en as "childEn"
      from invoice i join family f on f.id = i.family_id left join student s on s.id = i.student_id
      where i.id = ${id}`)) as unknown as Inv[];
    if (!inv) return null;
    const lines = (await tx.execute(sql`
      select item_type as "itemType", description, source, amount_piastres::text as amount, to_char(accrual_date, 'YYYY-MM-DD') as "accrualDate"
      from invoice_line where invoice_id = ${id} order by accrual_date nulls first, created_at`)) as unknown as {
      itemType: string; description: string; source: string; amount: string; accrualDate: string | null;
    }[];
    const payments = (await tx.execute(sql`
      select p.id, p.receipt_no as "receiptNo", p.received_at as "receivedAt", p.method, a.amount_piastres::text as amount, p.voided_at as "voidedAt"
      from payment_allocation a join payment p on p.id = a.payment_id where a.invoice_id = ${id} order by p.received_at`)) as unknown as {
      id: string; receiptNo: string; receivedAt: Date; method: string; amount: string; voidedAt: Date | null;
    }[];
    const credits = (await tx.execute(sql`
      select c.id, c.credit_no as "creditNo", c.kind, c.status, c.reason, c.amount_piastres::text as amount, c.refunded_at as "refundedAt",
        r.status as "requestStatus", r.step_count as "steps", r.current_step as "step"
      from credit_note c left join approval_request r on r.id = c.approval_request_id
      where c.invoice_id = ${id} order by c.created_at`)) as unknown as {
      id: string; creditNo: string | null; kind: string; status: string; reason: string; amount: string; refundedAt: Date | null;
      requestStatus: string | null; steps: number; step: number;
    }[];
    return { inv, lines, payments, credits };
  });
  if (!data) notFound();
  const { inv, lines, payments, credits } = data;
  const balance = BigInt(inv.total) - BigInt(inv.paid) - BigInt(inv.credited);
  const d = (iso: string) => formatPlainDate(iso, loc, user.digits);
  const n = (v: number) => formatNumber(v, loc, user.digits);
  const kinds = inv.kind === "late_fee" ? (["waiver"] as const) : (["correction", "refund"] as const);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${tm(`kinds.${inv.kind}`)} · ${monthLabel(inv.serviceMonth, locale, user.digits)}`}>
        <InvoiceStatus status={inv.status} overdue={inv.status !== "paid" && inv.dueDate < today} />
      </PageHeader>
      <MoneyResult searchParams={sp} />
      <Card>
        <dl className="grid grid-cols-2 gap-2 text-[14px]">
          <dt className="text-muted">{t("number")}</dt><dd className="figure" data-testid="invoice-no">{inv.invoiceNo}</dd>
          <dt className="text-muted">{t("child")}</dt><dd>{(locale === "ar" ? inv.childAr : inv.childEn) ?? t("wholeFamily")}</dd>
          <dt className="text-muted">{t("family")}</dt>
          <dd>
            <Link href={`/payment?branch=${inv.branchId}&family=${inv.familyId}`} className="text-brand underline">{inv.accountNo} · {inv.familyName}</Link>
          </dd>
          <dt className="text-muted">{t("issued")}</dt><dd>{d(inv.issueDate)}</dd>
          <dt className="text-muted">{t("due")}</dt><dd>{d(inv.dueDate)}</dd>
        </dl>
      </Card>

      <Card>
        <h2 className="text-section-title font-semibold">{t("lines")}</h2>
        <ul className="mt-2 flex flex-col divide-y divide-divider" data-testid="invoice-lines">
          {lines.map((l, i) => {
            const days = proratedDays(l.description);
            return (
              <li key={i} className="flex justify-between gap-3 py-2 text-[14px]">
                <span>
                  {tm(`items.${l.itemType}`)}
                  {l.accrualDate ? ` · ${d(l.accrualDate)}` : ""}
                  {l.source === "price_lock" ? ` · ${t("legacyPrice")}` : ""}
                  {l.source === "discount" ? ` · ${l.description}` : ""}
                  {days ? ` · ${t("prorated", { n: n(days[0]), of: n(days[1]) })}` : ""}
                </span>
                <Amount locale={locale} digits={user.digits} value={BigInt(l.amount)} />
              </li>
            );
          })}
        </ul>
        <dl className="mt-3 grid grid-cols-2 gap-1 border-t border-border pt-3 text-[14px]">
          <dt>{t("total")}</dt><dd className="text-end"><Amount locale={locale} digits={user.digits} value={BigInt(inv.total)} /></dd>
          <dt>{t("paid")}</dt><dd className="text-end"><Amount locale={locale} digits={user.digits} value={BigInt(inv.paid)} /></dd>
          {BigInt(inv.credited) > 0n ? (<><dt>{t("credited")}</dt><dd className="text-end"><Amount locale={locale} digits={user.digits} value={BigInt(inv.credited)} /></dd></>) : null}
          <dt className="font-semibold">{t("balance")}</dt><dd className="text-end font-semibold" data-testid="invoice-balance"><Amount locale={locale} digits={user.digits} value={balance} /></dd>
        </dl>
        {inv.kind === "late_fee" ? <p className="mt-2 text-meta text-muted">{t("lateFeeNote")}</p> : null}
      </Card>

      <Card>
        <h2 className="text-section-title font-semibold">{t("payments")}</h2>
        {payments.length === 0 ? <p className="mt-2 text-muted">{t("noPayments")}</p> : null}
        <ul className="mt-2 flex flex-col divide-y divide-divider">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
              <Link href={`/payments/${p.id}`} className="text-brand underline">
                <span className="figure">{p.receiptNo}</span>
              </Link>
              <span className="text-meta text-muted">{formatTimestamp(new Date(p.receivedAt), loc, user.digits)} · {tm(`methods.${p.method}`)}</span>
              {p.voidedAt ? <Flag tone="critical">{tm("voided")}</Flag> : <Amount locale={locale} digits={user.digits} value={BigInt(p.amount)} />}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-section-title font-semibold">{t("credits")}</h2>
        {credits.length === 0 ? <p className="mt-2 text-muted">{t("noCredits")}</p> : null}
        <ul className="mt-2 flex flex-col divide-y divide-divider" data-testid="credit-notes">
          {credits.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 py-2 text-[14px]">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>{tm(`creditKinds.${c.kind}`)}{c.creditNo ? <span className="figure"> · {c.creditNo}</span> : null}</span>
                <Amount locale={locale} digits={user.digits} value={BigInt(c.amount)} />
              </span>
              <span className="text-meta text-subtle">{c.reason}</span>
              <span className="flex flex-wrap items-center gap-2">
                {c.status === "approved" ? <Flag tone="good">{tm("approval.approved")}</Flag> : null}
                {c.status === "rejected" ? <Flag tone="critical">{tm("approval.declined")}</Flag> : null}
                {c.status === "pending_approval" ? (
                  <Flag tone="attention">{c.requestStatus === "question" ? tm("approval.question") : c.steps === 2 && c.step === 2 ? tm("approval.waitingOwner") : tm("approval.waiting")}</Flag>
                ) : null}
                {c.kind === "refund" && c.refundedAt ? <Flag tone="neutral">{t("refunded")}</Flag> : null}
              </span>
              {c.kind === "refund" && c.status === "approved" && !c.refundedAt && canRecordPayment(user, inv.branchId) ? (
                <form action={payRefund} className="mt-1 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="invoiceId" value={inv.id} />
                  <input type="hidden" name="creditNoteId" value={c.id} />
                  <SelectField id={`m-${c.id}`} name="method" label={t("refundMethod")} options={PAYMENT_METHODS.map((m) => ({ value: m, label: tm(`methods.${m}`) }))} />
                  <Button type="submit" variant="secondary">{t("payRefund")}</Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {canRequestCredit(user, inv.branchId) ? (
        <Card>
          <h2 className="text-section-title font-semibold">{t(inv.kind === "late_fee" ? "waiveTitle" : "creditTitle")}</h2>
          <p className="mt-1 text-meta text-muted">{t("creditHelp")}</p>
          <form action={requestCredit} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="credit-form">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="invoiceId" value={inv.id} />
            <SelectField id="cn-kind" name="kind" label={t("kind")} options={kinds.map((k) => ({ value: k, label: tm(`creditKinds.${k}`) }))} />
            <Field id="cn-amount" name="amount" label={t("amount")} inputMode="decimal" required />
            <div className="sm:col-span-2">
              <Field id="cn-reason" name="reason" label={t("reason")} required minLength={3} maxLength={500} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">{t("sendForApproval")}</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
