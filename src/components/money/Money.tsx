import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/Alert";
import { Flag } from "@/components/children/BranchTabs";
import { formatPiastres, type Digits, type Locale } from "@/lib/format";

/** An amount in EGP with tabular figures. Money is integer piastres (rule 5). */
export async function Amount({ value, locale, digits, className = "" }: { value: bigint; locale: string; digits: Digits; className?: string }) {
  const t = await getTranslations("money");
  const loc: Locale = locale === "en" ? "en" : "ar";
  return (
    <span className={`figure whitespace-nowrap ${className}`} dir="ltr">
      {loc === "ar" ? `${formatPiastres(value, loc, digits)} ${t("egp")}` : `${t("egp")} ${formatPiastres(value, loc, digits)}`}
    </span>
  );
}

/** Outcome of the last money action (?ok=… or ?error=…), in plain words. */
export async function MoneyResult({ searchParams }: { searchParams: { ok?: string; done?: string; error?: string } }) {
  const t = await getTranslations("money");
  if (searchParams.ok) {
    const key = `ok.${searchParams.done ?? searchParams.ok}`;
    return <Alert tone="good">{t.has(key) ? t(key as "ok.saved") : t("ok.saved")}</Alert>;
  }
  if (searchParams.error) {
    const key = `errors.${searchParams.error}`;
    return <Alert>{t.has(key) ? t(key as "errors.unknown") : t("errors.unknown")}</Alert>;
  }
  return null;
}

export async function InvoiceStatus({ status, overdue }: { status: string; overdue: boolean }) {
  const ts = await getTranslations("money.invoiceStatus");
  if (status === "paid") return <Flag tone="good">{ts("paid")}</Flag>;
  if (overdue) return <Flag tone="critical">{ts("overdue")}</Flag>;
  if (status === "part_paid") return <Flag tone="attention">{ts("part_paid")}</Flag>;
  return <Flag tone="neutral">{ts("open")}</Flag>;
}

/** A month as "November 2026". */
export function monthLabel(month: string, locale: string, digits: Digits) {
  const [y, m] = month.split("-").map(Number);
  const base = locale === "en" ? "en-EG" : "ar-EG";
  return new Intl.DateTimeFormat(`${base}-u-nu-${digits === "arabic" ? "arab" : "latn"}`, { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

export async function ExpenseStatus({ status, isRequest, reversal }: { status: string; isRequest: boolean; reversal: boolean }) {
  const te = await getTranslations("money.expenseStatus");
  if (reversal) return <Flag tone="neutral">{te("reversal")}</Flag>;
  if (status === "pending_approval") return <Flag tone="attention">{isRequest ? te("askedWaiting") : te("waiting")}</Flag>;
  if (status === "approved") return <Flag tone="good">{isRequest ? te("askedApproved") : te("approved")}</Flag>;
  if (status === "rejected") return <Flag tone="critical">{te("rejected")}</Flag>;
  if (status === "reversed") return <Flag tone="neutral">{te("reversed")}</Flag>;
  return <Flag tone="good">{te("recorded")}</Flag>;
}
