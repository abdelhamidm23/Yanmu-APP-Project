import "server-only";
import { sql } from "drizzle-orm";
import type { getTranslations } from "next-intl/server";
import type { Tx } from "./rls";
import { monthAppFigures } from "./closing";
import { CENTRAL_KEYS, egpText, type TemplateLine } from "@/lib/month-close";
import { monthEnd } from "@/lib/billing";
import { formatPiastres, formatTimestamp } from "@/lib/format";

type T = Awaited<ReturnType<typeof getTranslations>>;
const egp = (v: string | bigint | null) => (v === null ? null : Number(formatPiastres(BigInt(v), "en", "latin").replace(/,/g, "")));

/** The lines the month-close template asks for, with the app's figures (spec §8.10). */
export async function templateLines(tx: Tx, branchId: string, month: string, locale: "ar" | "en", t: T): Promise<TemplateLine[]> {
  const f = await monthAppFigures(tx, branchId, month);
  const name = (c: { nameAr: string; nameEn: string }) => (locale === "ar" ? c.nameAr : c.nameEn);
  const lines: TemplateLine[] = [
    { code: "check:billed", kind: "check", label: t("closing.month.lines.billed"), app: BigInt(f.billed), categoryId: null },
    { code: "check:late_fees", kind: "check", label: t("closing.month.lines.lateFees"), app: BigInt(f.lateFees), categoryId: null },
    { code: "check:collected", kind: "check", label: t("closing.month.lines.collected"), app: BigInt(f.collected), categoryId: null },
  ];
  // Every category with spending in the app is checked; costs paid centrally come on their own lines.
  for (const c of f.expenses) {
    if (BigInt(c.amount) !== 0n)
      lines.push({ code: `check:expense:${c.key}`, kind: "check", label: t("closing.month.lines.expense", { name: name(c) }), app: BigInt(c.amount), categoryId: c.id });
  }
  for (const k of CENTRAL_KEYS) {
    const c = f.expenses.find((e) => e.key === k);
    if (c) lines.push({ code: `central:${k}`, kind: "central", label: t("closing.month.lines.central", { name: name(c) }), app: null, categoryId: c.id });
  }
  lines.push({ code: "balance:cash", kind: "balance", label: t("closing.month.lines.cash"), app: null, categoryId: null });
  lines.push({ code: "balance:bank", kind: "balance", label: t("closing.month.lines.bank"), app: null, categoryId: null });
  return lines;
}

/** The template sheet: the app's figure is copied into "Your figure" so only differences need typing. */
export function templateSheet(lines: TemplateLine[], t: T) {
  const c = (k: string, width: number) => ({ header: t(`closing.month.template.${k}` as "closing.month.template.code"), width });
  return {
    title: t("closing.month.template.sheet"),
    columns: [c("code", 22), c("line", 40), c("app", 18), c("yours", 18), c("note", 50)],
    rows: lines.map((l) => [l.code, l.label, l.app === null ? "" : egpText(l.app), l.kind === "check" && l.app !== null ? egpText(l.app) : "", ""]),
  };
}

/** The month's Excel pack: summary, invoices, payments, expenses, cash box and credit notes (spec §8.10). */
export async function monthPack(tx: Tx, branchId: string, month: string, locale: "ar" | "en", t: T, digits: "arabic" | "latin") {
  const end = monthEnd(month);
  const c = (k: string) => ({ header: t(`money.exportColumns.${k}` as "money.exportColumns.date") });
  const yes = (v: unknown) => (v ? t("settings.common.yes") : t("settings.common.no"));
  const lines = await templateLines(tx, branchId, month, locale, t);

  const invoices = (await tx.execute(sql`
    select i.invoice_no, i.kind, i.status, to_char(i.issue_date, 'YYYY-MM-DD') as issue, to_char(i.due_date, 'YYYY-MM-DD') as due, f.account_no,
      i.total_piastres::text as total, i.paid_piastres::text as paid, i.credited_piastres::text as credited, i.is_demo
    from invoice i join family f on f.id = i.family_id
    where i.branch_id = ${branchId} and ((i.kind <> 'late_fee' and i.service_month = ${month}::date)
      or (i.kind = 'late_fee' and i.issue_date between ${month}::date and ${end}::date))
    order by i.invoice_no`)) as unknown as Record<string, string | boolean | null>[];
  const payments = (await tx.execute(sql`
    select p.receipt_no, p.received_at, p.method, p.reference, p.amount_piastres::text as amount, f.account_no, p.voided_at, p.void_reason, p.is_demo
    from payment p join family f on f.id = p.family_id
    where p.branch_id = ${branchId} and (p.received_at at time zone 'Africa/Cairo')::date between ${month}::date and ${end}::date
    order by p.received_at`)) as unknown as Record<string, string | boolean | Date | null>[];
  const expenses = (await tx.execute(sql`
    select to_char(e.spent_on, 'YYYY-MM-DD') as spent_on, c.name_ar, c.name_en, e.description, v.name as vendor, e.payment_method,
      e.amount_piastres::text as amount, e.status, e.is_demo
    from expense e join expense_category c on c.id = e.category_id left join vendor v on v.id = e.vendor_id
    where e.branch_id = ${branchId} and not e.is_request and e.spent_on between ${month}::date and ${end}::date order by e.spent_on, e.created_at`)) as unknown as Record<
    string,
    string | boolean | null
  >[];
  const cash = (await tx.execute(sql`
    select to_char(date, 'YYYY-MM-DD') as date, opening_float_piastres::text as opening, cash_in_piastres::text as cash_in,
      cash_out_piastres::text as cash_out, handed_over_piastres::text as handed, handed_to, counted_piastres::text as counted,
      variance_piastres::text as variance, closed_at, reconciled_at, is_demo
    from cash_session where branch_id = ${branchId} and date between ${month}::date and ${end}::date order by date`)) as unknown as Record<
    string,
    string | boolean | Date | null
  >[];
  const credits = (await tx.execute(sql`
    select n.credit_no, to_char((n.created_at at time zone 'Africa/Cairo')::date, 'YYYY-MM-DD') as date, i.invoice_no, n.kind, n.status,
      n.amount_piastres::text as amount, n.reason, n.is_demo
    from credit_note n join invoice i on i.id = n.invoice_id
    where n.branch_id = ${branchId} and (n.created_at at time zone 'Africa/Cairo')::date between ${month}::date and ${end}::date
    order by n.created_at`)) as unknown as Record<string, string | boolean | null>[];

  const pack = [
    {
      title: t("closing.month.pack.summary"),
      columns: [{ header: t("closing.month.template.line"), width: 40 }, { header: t("closing.month.template.app"), width: 18 }],
      rows: lines.filter((l) => l.kind === "check").map((l) => [l.label, egp(l.app)]),
    },
    {
      title: t("money.invoices.title"),
      columns: ["invoiceNo", "kind", "status", "issued", "due", "account", "total", "paid", "credited", "demo"].map(c),
      rows: invoices.map((r) => [
        r.invoice_no as string, t(`money.kinds.${r.kind}` as "money.kinds.tuition"), t(`money.invoiceStatus.${r.status}` as "money.invoiceStatus.open"),
        r.issue as string, r.due as string, r.account_no as string, egp(r.total as string), egp(r.paid as string), egp(r.credited as string), yes(r.is_demo),
      ]),
    },
    {
      title: t("money.payments.title"),
      columns: ["receiptNo", "time", "method", "reference", "amount", "account", "voided", "voidReason", "demo"].map(c),
      rows: payments.map((r) => [
        r.receipt_no as string, formatTimestamp(new Date(r.received_at as string), locale, digits), t(`money.methods.${r.method}` as "money.methods.cash"),
        (r.reference as string) ?? "", egp(r.amount as string), r.account_no as string, yes(r.voided_at), (r.void_reason as string) ?? "", yes(r.is_demo),
      ]),
    },
    {
      title: t("money.expenses.title"),
      columns: ["date", "category", "description", "vendor", "method", "amount", "status", "demo"].map(c),
      rows: expenses.map((r) => [
        r.spent_on as string, (locale === "ar" ? r.name_ar : r.name_en) as string, (r.description as string) ?? "", (r.vendor as string) ?? "",
        r.payment_method ? t(`money.methods.${r.payment_method}` as "money.methods.cash") : "", egp(r.amount as string),
        t(`money.expenseStatus.${r.status}` as "money.expenseStatus.recorded"), yes(r.is_demo),
      ]),
    },
    {
      title: t("money.cash.title"),
      columns: ["date", "float", "cashIn", "cashOut", "handedOver", "handedTo", "counted", "variance", "closed", "reconciled", "demo"].map(c),
      rows: cash.map((r) => [
        r.date as string, egp(r.opening as string), egp(r.cash_in as string), egp(r.cash_out as string), egp(r.handed as string), (r.handed_to as string) ?? "",
        egp(r.counted as string), egp(r.variance as string), yes(r.closed_at), yes(r.reconciled_at), yes(r.is_demo),
      ]),
    },
    {
      title: t("closing.month.pack.credits"),
      columns: [c("date"), c("invoiceNo"), { header: t("closing.month.pack.creditNo") }, c("kind"), c("status"), c("amount"), c("reason"), c("demo")],
      rows: credits.map((r) => [
        r.date as string, r.invoice_no as string, (r.credit_no as string) ?? "", t(`money.creditKinds.${r.kind}` as "money.creditKinds.refund"),
        t(`closing.month.pack.creditStatus.${r.status}` as "closing.month.pack.creditStatus.approved"), egp(r.amount as string), r.reason as string, yes(r.is_demo),
      ]),
    },
  ];
  return pack;
}
