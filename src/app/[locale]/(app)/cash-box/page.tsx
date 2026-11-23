import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { requireMoney } from "@/lib/require-user";
import { FINANCE_VIEW_ROLES, canReconcileCash, canUseCashBox, hasRoleIn } from "@/lib/permissions";
import { expectedCash } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";
import { formatPiastres, formatPlainDate, formatTimestamp } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Field, PageHeader } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";
import { Amount, MoneyResult } from "@/components/money/Money";
import { closeCashBox, openCashBox, reconcileCashBox } from "./actions";

type S = {
  id: string; date: string; opening: string; cashIn: string | null; cashOut: string | null; counted: string | null; handedOver: string | null;
  handedTo: string | null; variance: string | null; closedAt: Date | null; closedByName: string | null; reconciledAt: Date | null;
  reconciledByName: string | null; openedByName: string | null; isDemo: boolean;
};

/** Cash box (spec §8.5): open with the float, cash in and out through the day, count and hand over at close. */
export default async function CashBoxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; ok?: string; done?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "cash");
  const t = await getTranslations("money.cash");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, FINANCE_VIEW_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const sessions = (await tx.execute(sql`
      select c.id, to_char(c.date, 'YYYY-MM-DD') as date, c.opening_float_piastres::text as opening, c.cash_in_piastres::text as "cashIn",
        c.cash_out_piastres::text as "cashOut", c.counted_piastres::text as counted, c.handed_over_piastres::text as "handedOver",
        c.handed_to as "handedTo", c.variance_piastres::text as variance, c.closed_at as "closedAt", c.reconciled_at as "reconciledAt",
        cu.full_name as "closedByName", ru.full_name as "reconciledByName", ou.full_name as "openedByName", c.is_demo as "isDemo"
      from cash_session c left join app_user cu on cu.id = c.closed_by left join app_user ru on ru.id = c.reconciled_by
      left join app_user ou on ou.id = c.created_by
      where c.branch_id = ${b.id} order by c.date desc limit 31`)) as unknown as S[];
    const current = sessions.find((s) => s.date === today) ?? null;
    let live: { cashIn: bigint; cashOut: bigint } | null = null;
    if (current && !current.closedAt) {
      const [r] = (await tx.execute(sql`select cash_in::text as "in", cash_out::text as "out" from app_cash_session_totals(${current.id})`)) as unknown as {
        in: string; out: string;
      }[];
      live = { cashIn: BigInt(r.in), cashOut: BigInt(r.out) };
    }
    const [lim] = (await tx.execute(sql`select app_setting_bigint(${b.id}, 'cash.variance_alert_piastres', 20000)::text as v`)) as unknown as { v: string }[];
    return { branches, b, sessions, current, live, alertAt: BigInt(lim.v) };
  });
  if (!data) return <Card>{tm("noBranch")}</Card>;
  const { branches, b, sessions, current, live, alertAt } = data;
  const canUse = canUseCashBox(user, b.id);
  const canReconcile = canReconcileCash(user, b.id);
  const plain = (v: bigint) => formatPiastres(v, "en", "latin").replace(/,/g, "");
  const lastClosed = sessions.find((s) => s.closedAt && s.date < today);
  const suggestedFloat = lastClosed?.counted ? BigInt(lastClosed.counted) : null;
  const big = (alertAt: bigint, v: string | null) => v !== null && (BigInt(v) > alertAt || BigInt(v) < -alertAt);
  const varianceText = (v: bigint) => (v === 0n ? t("balanced") : v > 0n ? t("short") : t("over"));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")} />
      <BranchTabs branches={branches} current={b.id} path="/cash-box" locale={locale} label={tm("branch")} />
      <MoneyResult searchParams={sp} />

      {!current ? (
        <Card>
          <h2 className="text-section-title font-semibold">{t("todayTitle", { date: formatPlainDate(today, loc, user.digits) })}</h2>
          <p className="mt-1 text-[14px] text-subtle">{t("notOpen")}</p>
          {canUse ? (
            <form action={openCashBox} className="mt-3 flex flex-col gap-3" data-testid="open-cash">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="branchId" value={b.id} />
              <Field
                id="cash-float"
                name="float"
                label={t("float")}
                inputMode="decimal"
                required
                defaultValue={suggestedFloat !== null ? plain(suggestedFloat) : ""}
                hint={suggestedFloat !== null ? t("floatHint") : undefined}
              />
              <Button type="submit">{t("open")}</Button>
            </form>
          ) : null}
        </Card>
      ) : null}

      {current && live ? (
        <Card data-testid="cash-open">
          <h2 className="text-section-title font-semibold">{t("todayTitle", { date: formatPlainDate(today, loc, user.digits) })}</h2>
          <p className="text-meta text-muted">{t("openedBy", { name: current.openedByName ?? "—" })}</p>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[15px]">
            <dt>{t("float")}</dt>
            <dd><Amount locale={locale} digits={user.digits} value={BigInt(current.opening)} /></dd>
            <dt>{t("cashIn")}</dt>
            <dd><Amount locale={locale} digits={user.digits} value={live.cashIn} /></dd>
            <dt>{t("cashOut")}</dt>
            <dd><Amount locale={locale} digits={user.digits} value={-live.cashOut} /></dd>
            <dt className="font-semibold">{t("expected")}</dt>
            <dd className="font-semibold" data-testid="cash-expected">
              <Amount locale={locale} digits={user.digits} value={expectedCash({ opening: BigInt(current.opening), cashIn: live.cashIn, cashOut: live.cashOut })} />
            </dd>
          </dl>
          <p className="mt-2 text-meta text-muted">{t("liveNote")}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-[14px]">
            <Link href={`/payments?branch=${b.id}`} className="text-brand underline">{tm("links.payments")}</Link>
            <Link href={`/expenses?branch=${b.id}`} className="text-brand underline">{tm("links.expenses")}</Link>
          </div>
          {canUse ? (
            <form action={closeCashBox} className="mt-4 grid gap-3 border-t border-divider pt-4 sm:grid-cols-2" data-testid="close-cash">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="branchId" value={b.id} />
              <input type="hidden" name="sessionId" value={current.id} />
              <h3 className="font-semibold sm:col-span-2">{t("closeTitle")}</h3>
              <Field id="cash-handed" name="handedOver" label={t("handedOver")} inputMode="decimal" hint={t("handedOverHint")} />
              <Field id="cash-handed-to" name="handedTo" label={t("handedTo")} maxLength={120} />
              <div className="sm:col-span-2">
                <Field id="cash-counted" name="counted" label={t("counted")} inputMode="decimal" required hint={t("countedHint")} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" full>{t("close")}</Button>
              </div>
            </form>
          ) : null}
        </Card>
      ) : null}

      <h2 className="text-section-title font-semibold">{t("history")}</h2>
      {sessions.filter((s) => s.closedAt).length === 0 ? <Card>{t("noHistory")}</Card> : null}
      <ul className="flex flex-col gap-3">
        {sessions
          .filter((s) => s.closedAt)
          .map((s) => {
            const v = BigInt(s.variance ?? "0");
            return (
              <li key={s.id}>
                <Card data-testid={`cash-day-${s.date}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{formatPlainDate(s.date, loc, user.digits)}</h3>
                    <span className="flex flex-wrap gap-2">
                      {s.isDemo ? <Flag tone="attention">{tm("demo")}</Flag> : null}
                      {big(alertAt, s.variance) ? <Flag tone="critical">{t("varianceAlert")}</Flag> : v === 0n ? <Flag tone="good">{t("balanced")}</Flag> : null}
                      {s.reconciledAt ? <Flag tone="good">{t("reconciled")}</Flag> : null}
                    </span>
                  </div>
                  {big(alertAt, s.variance) ? (
                    <div className="mt-2">
                      <Alert>{t("varianceAlertText", { amount: formatPiastres(v < 0n ? -v : v, loc, user.digits), limit: formatPiastres(alertAt, loc, user.digits) })}</Alert>
                    </div>
                  ) : null}
                  <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[14px]">
                    <dt>{t("float")}</dt>
                    <dd><Amount locale={locale} digits={user.digits} value={BigInt(s.opening)} /></dd>
                    <dt>{t("cashIn")}</dt>
                    <dd><Amount locale={locale} digits={user.digits} value={BigInt(s.cashIn ?? "0")} /></dd>
                    <dt>{t("cashOut")}</dt>
                    <dd><Amount locale={locale} digits={user.digits} value={-BigInt(s.cashOut ?? "0")} /></dd>
                    <dt>{t("handedOver")}{s.handedTo ? ` · ${s.handedTo}` : ""}</dt>
                    <dd><Amount locale={locale} digits={user.digits} value={-BigInt(s.handedOver ?? "0")} /></dd>
                    <dt>{t("counted")}</dt>
                    <dd><Amount locale={locale} digits={user.digits} value={BigInt(s.counted ?? "0")} /></dd>
                    <dt className="font-semibold">{t("variance")} · {varianceText(v)}</dt>
                    <dd className="font-semibold"><Amount locale={locale} digits={user.digits} value={v < 0n ? -v : v} /></dd>
                  </dl>
                  <p className="mt-2 text-meta text-muted">
                    {t("closedBy", { name: s.closedByName ?? "—", when: formatTimestamp(new Date(s.closedAt!), loc, user.digits) })}
                    {s.reconciledAt ? ` · ${t("reconciledBy", { name: s.reconciledByName ?? "—" })}` : ""}
                  </p>
                  {canReconcile && !s.reconciledAt ? (
                    <form action={reconcileCashBox} className="mt-2">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="branchId" value={b.id} />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <button type="submit" className={buttonClasses("secondary")}>{t("reconcile")}</button>
                    </form>
                  ) : null}
                </Card>
              </li>
            );
          })}
      </ul>
      <a href={`/api/export/cash-box?locale=${locale}&branch=${b.id}`} className={`${buttonClasses("secondary")} self-start`}>{tm("export")}</a>
    </div>
  );
}
