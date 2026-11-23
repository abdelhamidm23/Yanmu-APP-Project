import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { PAY_STATUS_VIEWS, payStatusList, type PayStatus, type PayStatusView } from "@/db/money";
import { requireSection } from "@/lib/require-user";
import { PAY_STATUS_ROLES, hasRoleIn } from "@/lib/permissions";
import { daysOverdue } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber, formatPlainDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";

const TONE: Record<PayStatus, "good" | "attention" | "critical" | "neutral"> = { paid: "good", due: "attention", late: "critical", not_billed: "neutral" };

/**
 * "Who paid" for the front desk (owner, 2026-11-23): which families have paid and which have not, with
 * no amounts. Recording payments, the cash box and the money figures are the accountant's.
 */
export default async function PaidPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; view?: string; q?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireSection(locale, "paid");
  const t = await getTranslations("money.paid");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();
  const view: PayStatusView = (PAY_STATUS_VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as PayStatusView) : "unpaid";
  const q = (sp.q ?? "").trim();

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, PAY_STATUS_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    return { branches, b, rows: await payStatusList(tx, b.id, q, view) };
  });
  if (!data) return <Card>{tm("noBranch")}</Card>;
  const { branches, b, rows } = data;
  const n = (v: number) => formatNumber(v, loc, user.digits);
  const date = (iso: string) => formatPlainDate(iso, loc, user.digits);
  const base = `/paid?branch=${b.id}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")} />
      <BranchTabs branches={branches} current={b.id} path="/paid" locale={locale} label={tm("branch")} />
      <nav className="flex flex-wrap gap-2" aria-label={t("views")}>
        {PAY_STATUS_VIEWS.map((v) => (
          <Link
            key={v}
            href={`${base}&view=${v}`}
            aria-current={v === view ? "page" : undefined}
            data-testid={`view-${v}`}
            className={`inline-flex min-h-11 items-center rounded-button px-4 text-[14px] font-medium ${v === view ? "bg-brand text-white" : "border border-outline bg-surface"}`}
          >
            {t(`view.${v}`)}
          </Link>
        ))}
        <a href={`/api/export/pay-status?branch=${b.id}&view=${view}&locale=${loc}`} className="ms-auto inline-flex min-h-11 items-center text-brand underline" data-testid="export-paid">
          {tm("export")}
        </a>
      </nav>
      <form className="flex gap-2" action={`/${locale}/paid`} method="get" role="search">
        <input type="hidden" name="branch" value={b.id} />
        <input type="hidden" name="view" value={view} />
        <label htmlFor="paid-q" className="sr-only">{t("search")}</label>
        <input id="paid-q" name="q" defaultValue={q} placeholder={t("search")} className="min-h-11 flex-1 rounded-button border border-outline bg-surface px-3" data-testid="paid-search" />
        <button type="submit" className={buttonClasses("secondary")}>{t("find")}</button>
      </form>

      {rows.length === 0 ? <Card>{t(q ? "noMatch" : `empty.${view}`)}</Card> : null}
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="paid-rows">
        {rows.map((r) => (
          <li key={r.id} className="flex min-h-14 flex-col gap-1 px-4 py-3" data-testid="paid-row">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-row-title font-semibold">
                {(loc === "ar" ? r.childrenAr : r.childrenEn) || r.displayName}
              </span>
              <Flag tone={TONE[r.status]} testId="pay-status">{t(`status.${r.status}`)}</Flag>
            </span>
            <span className="text-meta text-subtle">
              <span className="figure">{r.accountNo}</span> · {r.displayName}
              {r.status === "late" && r.since ? <> · {t("lateSince", { date: date(r.since), days: n(daysOverdue(r.since, today)) })}</> : null}
              {r.status === "due" && r.since ? <> · {t("dueOn", { date: date(r.since) })}</> : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-meta text-muted">{t("askAccountant")}</p>
    </div>
  );
}
