import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { requireMoney } from "@/lib/require-user";
import { canVoidPayment } from "@/lib/permissions";
import { formatPiastres, formatTimestamp } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, PageHeader } from "@/components/settings/Fields";
import { Flag } from "@/components/children/BranchTabs";
import { Amount, MoneyResult, monthLabel } from "@/components/money/Money";
import { ReceiptActions } from "@/components/money/ReceiptActions";
import { voidPayment } from "./actions";

type P = {
  id: string; branchId: string; receiptNo: string; receivedAt: Date; method: string; reference: string | null; amount: string;
  voidedAt: Date | null; voidReason: string | null; voidedByName: string | null; byName: string | null; createdBy: string | null;
  accountNo: string; familyName: string; familyId: string; branchAr: string; branchEn: string; isDemo: boolean;
};

/** The receipt (spec §8.4.3): numbered, printable, shareable as an image; void with a reason. */
export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ok?: string; done?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "view");
  const t = await getTranslations("money.receipt");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const data = await withUserDb(user.id, async (tx) => {
    const [p] = (await tx.execute(sql`
      select p.id, p.branch_id as "branchId", p.receipt_no as "receiptNo", p.received_at as "receivedAt", p.method, p.reference,
        p.amount_piastres::text as amount, p.voided_at as "voidedAt", p.void_reason as "voidReason", p.is_demo as "isDemo",
        vu.full_name as "voidedByName", cu.full_name as "byName", p.created_by as "createdBy",
        f.account_no as "accountNo", f.display_name as "familyName", f.id as "familyId", b.name_ar as "branchAr", b.name_en as "branchEn"
      from payment p join family f on f.id = p.family_id join branch b on b.id = p.branch_id
      left join app_user vu on vu.id = p.voided_by left join app_user cu on cu.id = p.created_by
      where p.id = ${id}`)) as unknown as P[];
    if (!p) return null;
    const allocations = (await tx.execute(sql`
      select i.id, i.invoice_no as "invoiceNo", i.kind, to_char(i.service_month, 'YYYY-MM-DD') as "serviceMonth", a.amount_piastres::text as amount
      from payment_allocation a join invoice i on i.id = a.invoice_id where a.payment_id = ${id} order by a.created_at`)) as unknown as {
      id: string; invoiceNo: string; kind: string; serviceMonth: string; amount: string;
    }[];
    return { p, allocations };
  });
  if (!data) notFound();
  const { p, allocations } = data;
  const amount = BigInt(p.amount);
  const allocated = allocations.reduce((s, a) => s + BigInt(a.amount), 0n);
  const credit = amount - allocated;
  const when = formatTimestamp(new Date(p.receivedAt), loc, user.digits);
  const egp = (v: bigint) => (loc === "ar" ? `${formatPiastres(v, loc, user.digits)} ${tm("egp")}` : `${tm("egp")} ${formatPiastres(v, loc, user.digits)}`);
  const canVoid = !p.voidedAt && canVoidPayment(user, p.branchId) && p.createdBy !== user.id;

  const shareLines: [string, string][] = [
    [`${t("title")} · ${loc === "ar" ? p.branchAr : p.branchEn}`, ""],
    [t("number"), p.receiptNo],
    [t("date"), when],
    [t("account"), p.accountNo],
    [t("amount"), egp(amount)],
    [t("method"), tm(`methods.${p.method}`)],
    ...allocations.map((a): [string, string] => [`${tm(`kinds.${a.kind}`)} · ${monthLabel(a.serviceMonth, locale, user.digits)}`, egp(BigInt(a.amount))]),
    ...(credit > 0n ? [[t("onAccount"), egp(credit)] as [string, string]] : []),
    ...(p.voidedAt ? [[t("voidedTitle"), ""] as [string, string]] : []),
    ...(p.isDemo ? [[t("demo"), ""] as [string, string]] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")}>
        <Link href={`/payment?branch=${p.branchId}&family=${p.familyId}`} className="text-brand underline print:hidden">{t("statement")}</Link>
      </PageHeader>
      <MoneyResult searchParams={sp} />
      <Card data-testid="receipt">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-meta text-muted">{loc === "ar" ? p.branchAr : p.branchEn}</p>
            <h2 className="text-section-title font-semibold">
              {t("number")} <span className="figure" data-testid="receipt-no">{p.receiptNo}</span>
            </h2>
            <p className="text-meta text-muted">{when}</p>
          </div>
          {p.voidedAt ? <Flag tone="critical">{tm("voided")}</Flag> : null}
          {p.isDemo ? <Flag tone="attention">{t("demo")}</Flag> : null}
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
          <dt className="text-subtle">{t("family")}</dt>
          <dd>{p.accountNo} · {p.familyName}</dd>
          <dt className="text-subtle">{t("amount")}</dt>
          <dd className="font-semibold" data-testid="receipt-amount"><Amount locale={locale} digits={user.digits} value={amount} /></dd>
          <dt className="text-subtle">{t("method")}</dt>
          <dd>{tm(`methods.${p.method}`)}{p.reference ? ` · ${p.reference}` : ""}</dd>
          <dt className="text-subtle">{t("by")}</dt>
          <dd>{p.byName ?? "—"}</dd>
        </dl>
        <h3 className="mt-4 font-semibold">{t("paidFor")}</h3>
        <ul className="mt-1 flex flex-col divide-y divide-divider text-[14px]">
          {allocations.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={`/invoices/${a.id}`} className="text-brand underline">
                <span className="figure">{a.invoiceNo}</span> · {tm(`kinds.${a.kind}`)} · {monthLabel(a.serviceMonth, locale, user.digits)}
              </Link>
              <Amount locale={locale} digits={user.digits} value={BigInt(a.amount)} />
            </li>
          ))}
          {credit > 0n ? (
            <li className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{t("onAccount")}</span>
              <Amount locale={locale} digits={user.digits} value={credit} />
            </li>
          ) : null}
        </ul>
        {p.voidedAt ? (
          <p className="mt-3 text-[14px] text-critical">
            {t("voidedBy", { name: p.voidedByName ?? "—", when: formatTimestamp(new Date(p.voidedAt), loc, user.digits) })} · {p.voidReason}
          </p>
        ) : null}
        <div className="mt-4">
          <ReceiptActions
            lines={shareLines}
            fileName={p.receiptNo}
            dir={loc === "ar" ? "rtl" : "ltr"}
            labels={{ print: t("print"), share: t("share"), saved: t("saved") }}
          />
          <p className="mt-2 text-meta text-muted print:hidden">{t("shareNote")}</p>
        </div>
      </Card>

      {canVoid ? (
        <Card className="print:hidden">
          <h2 className="text-section-title font-semibold">{t("voidTitle")}</h2>
          <p className="mt-1 text-[14px] text-subtle">{t("voidHelp")}</p>
          <form action={voidPayment} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="paymentId" value={p.id} />
            <Field id="void-reason" name="reason" label={t("voidReason")} required minLength={3} maxLength={500} />
            <Button type="submit" variant="danger" data-testid="void-payment">{t("void")}</Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
