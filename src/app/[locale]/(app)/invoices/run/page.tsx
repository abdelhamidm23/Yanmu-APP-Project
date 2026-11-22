import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { previewInvoiceRun } from "@/db/billing";
import { requireMoney } from "@/lib/require-user";
import { canRunInvoices, hasRoleIn } from "@/lib/permissions";
import { monthStart, proratedDays, shiftMonth } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber, formatPlainDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";
import { Amount, MoneyResult, monthLabel } from "@/components/money/Money";
import { postRun } from "./actions";

/** Monthly invoice run with its preview (spec §8.4.1). The accountant checks it, then issues the invoices. */
export default async function InvoiceRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; month?: string; ok?: string; error?: string; created?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "run");
  const t = await getTranslations("money.run");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();
  const month = sp.month && /^\d{4}-\d{2}-01$/.test(sp.month) ? sp.month : monthStart(today);

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, ["accountant"], b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    return { branches, b, run: await previewInvoiceRun(tx, b.id, month) };
  });
  if (!data) return <Card>{tm("noBranch")}</Card>;
  const { branches, b, run } = data;
  const n = (v: number) => formatNumber(v, loc, user.digits);
  const toIssue = run.rows.filter((r) => !r.invoiceId && !r.warning);
  const missing = run.rows.filter((r) => r.warning);
  const done = run.rows.filter((r) => r.invoiceId);
  const total = toIssue.reduce((s, r) => s + r.total, 0n);
  const months = [-1, 0, 1].map((d) => shiftMonth(monthStart(today), d));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")} />
      <BranchTabs branches={branches} current={b.id} path="/invoices/run" locale={locale} label={tm("branch")} />
      {sp.ok ? (
        <MoneyResult searchParams={{ ok: "1", done: Number(sp.created) > 0 ? "issued" : "nothingToIssue" }} />
      ) : (
        <MoneyResult searchParams={sp} />
      )}
      <nav className="flex flex-wrap gap-2" aria-label={t("month")}>
        {months.map((m) => (
          <Link
            key={m}
            href={`/invoices/run?branch=${b.id}&month=${m}`}
            aria-current={m === month ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-button px-4 text-[14px] font-medium ${m === month ? "bg-brand text-white" : "border border-outline bg-surface"}`}
          >
            {monthLabel(m, locale, user.digits)}
          </Link>
        ))}
      </nav>

      <Card data-testid="run-summary">
        <p className="text-[15px]">{t("summary", { issue: n(toIssue.length), done: n(done.length), workingDays: n(run.workingDays) })}</p>
        <p className="mt-1 text-[15px]">
          {t("due")}: {formatPlainDate(run.dueDate, loc, user.digits)} · {t("total")}: <Amount value={total} locale={locale} digits={user.digits} className="font-semibold" />
        </p>
        {missing.length > 0 ? <p className="mt-2 text-critical">{t("missingFee", { n: n(missing.length) })}</p> : null}
        {canRunInvoices(user, b.id) && toIssue.length > 0 ? (
          <form action={postRun} className="mt-3">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="branchId" value={b.id} />
            <input type="hidden" name="month" value={month} />
            <Button type="submit" data-testid="post-run">{t("post", { n: n(toIssue.length) })}</Button>
          </form>
        ) : null}
      </Card>

      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="run-rows">
        {[...missing, ...toIssue, ...done].map((r) => (
          <li key={r.studentId} className="flex flex-col gap-1 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-row-title font-semibold">{locale === "ar" ? r.nameAr : r.nameEn}</span>
              {r.warning ? <Flag tone="critical">{t("noFee")}</Flag> : <Amount value={r.total} locale={locale} digits={user.digits} className="font-semibold" />}
            </div>
            <span className="flex flex-wrap items-center gap-2 text-meta text-subtle">
              {r.accountNo} · {locale === "ar" ? r.roomAr : r.roomEn}
              {r.lines.map((l, i) => {
                const days = proratedDays(l.description);
                return (
                  <span key={i}>
                    · {tm(`items.${l.itemType}`)}
                    {l.source === "price_lock" ? ` (${t("legacy")})` : ""}
                    {l.source === "discount" ? ` (${l.description})` : ""}
                    {days ? ` (${t("days", { n: n(days[0]), of: n(days[1]) })})` : ""}
                  </span>
                );
              })}
              {r.invoiceId ? (
                <Link href={`/invoices/${r.invoiceId}`} className="text-brand underline">
                  {t("alreadyIssued")}
                </Link>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {run.rows.length === 0 ? <Card>{t("empty")}</Card> : null}
    </div>
  );
}
