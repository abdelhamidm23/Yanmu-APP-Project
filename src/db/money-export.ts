import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { getTranslations } from "next-intl/server";
import { withUserDb } from "./rls";
import { cairoDayStart } from "./money";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";
import { canViewExpenses, canViewMoney } from "@/lib/permissions";
import { formatPiastres, formatTimestamp } from "@/lib/format";
import { monthEnd } from "@/lib/billing";
import type { CurrentUser } from "@/lib/session";

export const MONEY_LISTS = ["invoices", "payments", "expenses", "cash-box", "price-locks"] as const;
type T = Awaited<ReturnType<typeof getTranslations>>;

/** Piastres → an EGP number for the spreadsheet cell (display only; sums in the app stay in bigint, rule 5). */
const egp = (v: string | bigint | null) => (v === null ? null : Number(formatPiastres(BigInt(v), "en", "latin").replace(/,/g, "")));

/** Excel exports of the money lists (rule 13). Row-level security limits every row. */
export async function moneyExport(list: string, url: URL, user: CurrentUser, t: T, locale: "ar" | "en", stamp: string): Promise<Response | null> {
  const nf = () => new Response("Not found", { status: 404 });
  const branchId = z.uuid().safeParse(url.searchParams.get("branch"));
  if (!branchId.success) return nf();
  const b = branchId.data;
  const c = (k: string) => ({ header: t(`money.exportColumns.${k}` as "money.exportColumns.date") });
  const yes = (v: unknown) => (v ? t("settings.common.yes") : t("settings.common.no"));

  if (list === "invoices") {
    if (!canViewMoney(user, b)) return nf();
    const rows = (await withUserDb(user.id, (tx) =>
      tx.execute(sql`
        select i.invoice_no, i.kind, i.status, to_char(i.service_month, 'YYYY-MM') as month, to_char(i.issue_date, 'YYYY-MM-DD') as issue,
          to_char(i.due_date, 'YYYY-MM-DD') as due, f.account_no, f.display_name, s.full_name_ar, s.full_name_en,
          i.total_piastres::text as total, i.paid_piastres::text as paid, i.credited_piastres::text as credited,
          (i.total_piastres - i.paid_piastres - i.credited_piastres)::text as balance, i.is_demo
        from invoice i join family f on f.id = i.family_id left join student s on s.id = i.student_id
        where i.branch_id = ${b} order by i.service_month desc, i.invoice_no`),
    )) as unknown as Record<string, string | boolean | null>[];
    const body = await buildWorkbook(
      t("money.invoices.title"),
      ["invoiceNo", "kind", "status", "month", "issued", "due", "account", "family", "childAr", "childEn", "total", "paid", "credited", "balance", "demo"].map(c),
      rows.map((r) => [
        r.invoice_no as string, t(`money.kinds.${r.kind}` as "money.kinds.tuition"), t(`money.invoiceStatus.${r.status}` as "money.invoiceStatus.open"),
        r.month as string, r.issue as string, r.due as string, r.account_no as string, r.display_name as string, (r.full_name_ar as string) ?? "",
        (r.full_name_en as string) ?? "", egp(r.total as string), egp(r.paid as string), egp(r.credited as string), egp(r.balance as string), yes(r.is_demo),
      ]),
      locale,
    );
    return xlsxResponse(body, `invoices-${stamp}.xlsx`);
  }

  if (list === "payments") {
    if (!canViewMoney(user, b)) return nf();
    const date = z.iso.date().catch(stamp).parse(url.searchParams.get("date") ?? stamp);
    const from = cairoDayStart(date);
    const to = new Date(from.getTime() + 86_400_000);
    const rows = (await withUserDb(user.id, (tx) =>
      tx.execute(sql`
        select p.receipt_no, p.received_at, p.method, p.reference, p.amount_piastres::text as amount, f.account_no, f.display_name,
          u.full_name as by_name, p.voided_at, p.void_reason, p.is_demo
        from payment p join family f on f.id = p.family_id left join app_user u on u.id = p.created_by
        where p.branch_id = ${b} and p.received_at >= ${from.toISOString()} and p.received_at < ${to.toISOString()} order by p.received_at`),
    )) as unknown as Record<string, unknown>[];
    const body = await buildWorkbook(
      t("money.payments.title"),
      ["receiptNo", "time", "method", "reference", "amount", "account", "family", "by", "voided", "voidReason", "demo"].map(c),
      rows.map((r) => [
        r.receipt_no as string, formatTimestamp(new Date(r.received_at as string), locale, "latin"), t(`money.methods.${r.method}` as "money.methods.cash"),
        (r.reference as string) ?? "", egp(r.amount as string), r.account_no as string, r.display_name as string, (r.by_name as string) ?? "",
        yes(r.voided_at), (r.void_reason as string) ?? "", yes(r.is_demo),
      ]),
      locale,
    );
    return xlsxResponse(body, `payments-${date}.xlsx`);
  }

  if (list === "expenses") {
    if (!canViewExpenses(user, b)) return nf();
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") ?? "") ? `${url.searchParams.get("month")}-01` : `${stamp.slice(0, 7)}-01`;
    const rows = (await withUserDb(user.id, (tx) =>
      tx.execute(sql`
        select to_char(e.spent_on, 'YYYY-MM-DD') as spent_on, c.name_ar, c.name_en, e.description, v.name as vendor, e.payment_method,
          e.amount_piastres::text as amount, e.status, e.is_request, e.unusual_reason, u.full_name as by_name, e.receipt_attachment_id is not null as has_receipt, e.is_demo
        from expense e join expense_category c on c.id = e.category_id left join vendor v on v.id = e.vendor_id left join app_user u on u.id = e.created_by
        where e.branch_id = ${b} and e.spent_on between ${month}::date and ${monthEnd(month)}::date order by e.spent_on, e.created_at`),
    )) as unknown as Record<string, unknown>[];
    const body = await buildWorkbook(
      t("money.expenses.title"),
      ["date", "category", "description", "vendor", "method", "amount", "status", "by", "receipt", "demo"].map(c),
      rows.map((r) => [
        r.spent_on as string, (locale === "ar" ? r.name_ar : r.name_en) as string, r.description as string, (r.vendor as string) ?? "",
        t(`money.methods.${r.payment_method}` as "money.methods.cash"), egp(r.amount as string),
        t(`money.expenseStatus.${r.status === "pending_approval" ? "waiting" : r.status}` as "money.expenseStatus.recorded"),
        (r.by_name as string) ?? "", yes(r.has_receipt), yes(r.is_demo),
      ]),
      locale,
    );
    return xlsxResponse(body, `expenses-${month.slice(0, 7)}.xlsx`);
  }

  if (list === "cash-box") {
    if (!canViewMoney(user, b)) return nf();
    const rows = (await withUserDb(user.id, (tx) =>
      tx.execute(sql`
        select to_char(date, 'YYYY-MM-DD') as date, opening_float_piastres::text as opening, cash_in_piastres::text as cash_in,
          cash_out_piastres::text as cash_out, handed_over_piastres::text as handed_over, handed_to, counted_piastres::text as counted,
          variance_piastres::text as variance, closed_at, reconciled_at, is_demo
        from cash_session where branch_id = ${b} order by date desc`),
    )) as unknown as Record<string, string | null>[];
    const body = await buildWorkbook(
      t("money.cash.title"),
      ["date", "float", "cashIn", "cashOut", "handedOver", "handedTo", "counted", "variance", "closed", "reconciled", "demo"].map(c),
      rows.map((r) => [
        r.date, egp(r.opening), egp(r.cash_in), egp(r.cash_out), egp(r.handed_over), r.handed_to ?? "", egp(r.counted), egp(r.variance),
        yes(r.closed_at), yes(r.reconciled_at), yes(r.is_demo),
      ]),
      locale,
    );
    return xlsxResponse(body, `cash-box-${stamp}.xlsx`);
  }

  if (list === "price-locks") {
    if (!canViewMoney(user, b)) return nf();
    const rows = (await withUserDb(user.id, (tx) =>
      tx.execute(sql`
        select s.student_no, s.full_name_ar, s.full_name_en, p.item_type, p.amount_piastres::text as amount, p.reason,
          to_char(p.starts_on, 'YYYY-MM-DD') as starts_on, to_char(p.ends_on, 'YYYY-MM-DD') as ends_on, u.full_name as by_name, p.is_demo
        from price_lock p join student s on s.id = p.student_id left join app_user u on u.id = p.approved_by
        where p.branch_id = ${b} order by s.full_name_en`),
    )) as unknown as Record<string, string | boolean | null>[];
    const body = await buildWorkbook(
      t("money.locks.title"),
      ["studentNo", "childAr", "childEn", "item", "amount", "reason", "from", "to", "approvedBy", "demo"].map(c),
      rows.map((r) => [
        r.student_no as string, r.full_name_ar as string, r.full_name_en as string, t(`money.items.${r.item_type}` as "money.items.tuition"),
        egp(r.amount as string), r.reason as string, r.starts_on as string, (r.ends_on as string) ?? "", (r.by_name as string) ?? "", yes(r.is_demo),
      ]),
      locale,
    );
    return xlsxResponse(body, `legacy-prices-${stamp}.xlsx`);
  }
  return null;
}
