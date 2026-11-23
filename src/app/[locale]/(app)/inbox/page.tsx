import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { approvalTrail, openMoneyRequests, type InboxItem } from "@/db/money";
import { incidentsWaitingFor, myAlerts, overdueActions } from "@/db/safety";
import { requireUser } from "@/lib/require-user";
import { myTurnToDecide, canSeeChildApprovals, canDecideMoney, canRequestCredit, canRecordExpense, canViewSafety } from "@/lib/permissions";
import { alertText } from "@/lib/alert-text";
import { formatPlainDate } from "@/lib/format";
import { SafetyResult, SeverityFlag } from "@/components/safety/Safety";
import { ackAlert, markAlertsRead } from "./alert-actions";
import { formatTimestamp } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { Flag } from "@/components/children/BranchTabs";
import { Amount, MoneyResult } from "@/components/money/Money";
import { ApprovalTrail } from "@/components/money/ApprovalTrail";
import { decide } from "./actions";

/**
 * Inbox (spec §8.6, §9.4, §10, §11.1): this person's alerts (critical ones first, with "I'm on it"),
 * incidents waiting for their review or sign-off, overdue actions, and money approvals for those who decide them.
 */
export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ok?: string; done?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations("money.inbox");
  const tm = await getTranslations("money");
  const ta = await getTranslations("alerts");
  const ts = await getTranslations("safety");
  const loc = locale === "en" ? "en" : "ar";
  const money = canDecideMoney(user) || canRequestCredit(user) || canRecordExpense(user);
  const safetyViewer = canViewSafety(user);

  const { items, alerts, waiting, overdue } = await withUserDb(user.id, async (tx) => {
    const open = money ? await openMoneyRequests(tx) : [];
    return {
      items: await Promise.all(open.map(async (r) => ({ r, trail: (await approvalTrail(tx, r.id))!, turn: myTurnToDecide(user, r) }))),
      alerts: await myAlerts(tx, user.id),
      waiting: await incidentsWaitingFor(tx, user),
      // Managers see every overdue item of their branches (RLS); everyone else only theirs.
      overdue: await overdueActions(tx, null, safetyViewer ? undefined : user.id),
    };
  });
  const when = (d: Date | string) => formatTimestamp(new Date(d), loc, user.digits);
  const alertHref = (a: (typeof alerts)[number]) =>
    a.subjectTable === "incident" ? `/incidents/${a.subjectId}`
    : a.subjectTable === "issue" ? `/issues/${a.subjectId}`
    : a.subjectTable === "expense" ? `/expenses/${a.subjectId}`
    : a.subjectTable === "daily_close" || a.key.startsWith("daily_close") ? `/daily-close?branch=${a.branchId}`
    : a.subjectTable === "cash_session" ? `/cash-box?branch=${a.branchId}`
    : `/today?branch=${a.branchId}`;
  const unread = alerts.filter((a) => !a.readAt).length;
  const mineToDecide = items.filter((x) => x.turn);
  const myRequests = items.filter((x) => x.r.requestedBy === user.id);
  const others = items.filter((x) => !x.turn && x.r.requestedBy !== user.id);

  const what = (r: InboxItem) =>
    r.type === "expense"
      ? `${loc === "ar" ? r.categoryAr : r.categoryEn} · ${r.description ?? ""}${r.vendor ? ` · ${r.vendor}` : ""}`
      : `${r.invoiceNo ?? ""} · ${r.accountNo ?? ""} ${r.familyName ?? ""}`;
  const link = (r: InboxItem) => (r.type === "expense" ? `/expenses/${r.expenseId}` : `/invoices/${r.invoiceId}`);

  const Item = ({ x }: { x: (typeof items)[number] }) => (
    <Card id={`r-${x.r.id}`} data-testid="inbox-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-meta text-muted">
            {tm(`requestTypes.${x.r.type}`)} · {loc === "ar" ? x.r.branchAr : x.r.branchEn}
            {x.r.isRequest ? ` · ${t("beforeSpending")}` : ""}
          </span>
          <Link href={link(x.r)} className="font-semibold text-brand underline">{what(x.r)}</Link>
          {x.r.creditReason ? <span className="text-[14px]">{x.r.creditReason}</span> : null}
        </div>
        <span className="text-row-title font-semibold"><Amount value={BigInt(x.r.amount ?? "0")} locale={locale} digits={user.digits} /></span>
      </div>
      {x.r.receipt ? (
        <a href={`/api/attachment/${x.r.receipt}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[14px] text-brand underline">{t("receipt")}</a>
      ) : null}
      <div className="mt-3">
        <ApprovalTrail request={x.trail.request} steps={x.trail.steps} locale={locale} digits={user.digits} />
      </div>
      {x.turn ? (
        <form action={decide} className="mt-3 flex flex-col gap-2 border-t border-divider pt-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="requestId" value={x.r.id} />
          <label htmlFor={`c-${x.r.id}`} className="text-[13px] font-medium text-subtle">{t("comment")}</label>
          <textarea id={`c-${x.r.id}`} name="comment" rows={2} maxLength={1000} className="rounded-button border border-outline bg-surface p-3" />
          <p className="text-meta text-muted">{x.turn === "recommend" ? t("recommendHelp") : t("commentHelp")}</p>
          <div className="flex flex-wrap gap-2">
            {x.turn === "decide" ? (
              <>
                <Button type="submit" name="decision" value="approve" variant="success" data-testid="approve">{t("approve")}</Button>
                <Button type="submit" name="decision" value="reject" variant="danger" data-testid="reject">{t("reject")}</Button>
              </>
            ) : (
              <>
                <Button type="submit" name="decision" value="recommend_approve" variant="success" data-testid="recommend-approve">{t("recommendApprove")}</Button>
                <Button type="submit" name="decision" value="recommend_reject" variant="danger" data-testid="recommend-reject">{t("recommendReject")}</Button>
              </>
            )}
            <Button type="submit" name="decision" value="question" variant="secondary" data-testid="ask">{t("ask")}</Button>
          </div>
        </form>
      ) : null}
      {x.r.status === "question" && x.r.requestedBy === user.id ? (
        <Link href={link(x.r)} className="mt-3 inline-block font-semibold text-brand underline">{t("answerNow")}</Link>
      ) : null}
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={ta("inboxTitle")} />
      {sp.done === "acknowledged" ? <SafetyResult searchParams={sp} /> : <MoneyResult searchParams={sp} />}

      <section className="flex flex-col gap-3" aria-labelledby="inbox-alerts" data-testid="inbox-alerts">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="inbox-alerts" className="text-section-title font-semibold">
            {ta("bell")} {unread ? <Flag tone="attention">{unread}</Flag> : null}
          </h2>
          {unread ? (
            <form action={markAlertsRead}>
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="secondary">{ta("markRead")}</Button>
            </form>
          ) : null}
        </div>
        {alerts.length === 0 ? <Card>{ta("none")}</Card> : null}
        {alerts.length ? (
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
            {alerts.map((a) => {
              const text = alertText(a.key, loc, { ar: a.branchAr, en: a.branchEn });
              const live = a.tier === "critical" && !a.acknowledgedAt && !a.resolvedAt;
              return (
                <li key={a.notificationId} className={`flex flex-col gap-2 px-4 py-3 ${live ? "bg-critical-bg" : ""}`} data-testid="alert-row">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={alertHref(a)} className={`font-semibold underline ${live ? "text-critical" : "text-brand"}`}>{text.title}</Link>
                    {!a.readAt ? <Flag tone="attention">{ta("new")}</Flag> : null}
                    {a.resolvedAt ? <Flag tone="good">{ta("handled")}</Flag> : null}
                    {a.isDemo ? <Flag tone="neutral">{ts("demo")}</Flag> : null}
                  </span>
                  <span className="figure text-meta text-muted">
                    {when(a.raisedAt)}
                    {a.step > 1 ? ` · ${ta("step", { n: String(a.step) })}` : ""}
                    {a.acknowledgedAt ? ` · ${ta("ackedBy", { name: a.acknowledgedBy ?? "—", when: when(a.acknowledgedAt) })}` : ""}
                  </span>
                  {live ? (
                    <form action={ackAlert}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="alertId" value={a.alertId} />
                      <input type="hidden" name="back" value="/inbox" />
                      <Button type="submit" variant="danger" data-testid="inbox-ack">{ta("ack")}</Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {waiting.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="inbox-incidents" data-testid="inbox-incidents">
          <h2 id="inbox-incidents" className="text-section-title font-semibold">{ta("incidentsToReview")}</h2>
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
            {waiting.map((i) => (
              <li key={i.id}>
                <Link href={`/incidents/${i.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-bg">
                  <span className="flex flex-col">
                    <span className="font-semibold">{ts(`category.${i.category}` as "category.other")}</span>
                    <span className="figure text-meta text-muted">
                      {loc === "ar" ? i.branchAr : i.branchEn} · {when(i.occurredAt)} · {i.reviewedAt ? ts("detail.waitingOwner") : ts("detail.waitingReview")}
                    </span>
                  </span>
                  <SeverityFlag severity={i.severity} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {overdue.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="inbox-overdue" data-testid="inbox-overdue">
          <h2 id="inbox-overdue" className="text-section-title font-semibold">{ta("overdueTitle")}</h2>
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
            {overdue.map((o) => (
              <li key={`${o.kind}-${o.id}`}>
                <Link href={o.kind === "issue" ? `/issues/${o.id}` : `/incidents/${o.parentId}`} className="flex min-h-14 flex-col gap-1 px-4 py-3 hover:bg-bg">
                  <span className="font-semibold">{o.title}</span>
                  <span className="figure text-meta text-critical">
                    {ts("detail.due", { date: formatPlainDate(o.dueOn, loc, user.digits) })} · {o.owner ?? "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {money ? <h2 className="mt-2 text-section-title font-semibold">{ta("approvalsTitle")}</h2> : null}
      {money ? <p className="text-meta text-muted">{t("help")}</p> : null}
      {canSeeChildApprovals(user) ? (
        <Link href="/children/approvals" className="text-brand underline">{t("childApprovals")}</Link>
      ) : null}

      {money ? (
      <section className="flex flex-col gap-3" aria-labelledby="inbox-mine">
        <h2 id="inbox-mine" className="text-section-title font-semibold">
          {t("forYou")} {mineToDecide.length ? <Flag tone="attention">{mineToDecide.length}</Flag> : null}
        </h2>
        {mineToDecide.length === 0 ? <Card>{t("nothingForYou")}</Card> : mineToDecide.map((x) => <Item key={x.r.id} x={x} />)}
      </section>
      ) : null}

      {myRequests.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="inbox-asked">
          <h2 id="inbox-asked" className="text-section-title font-semibold">{t("yourRequests")}</h2>
          {myRequests.map((x) => <Item key={x.r.id} x={x} />)}
        </section>
      ) : null}

      {others.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="inbox-others">
          <h2 id="inbox-others" className="text-section-title font-semibold">{t("others")}</h2>
          <p className="text-meta text-muted">{t("othersHelp")}</p>
          {others.map((x) => <Item key={x.r.id} x={x} />)}
        </section>
      ) : null}
      <p className="text-meta text-muted">{t("updated", { when: formatTimestamp(new Date(), loc, user.digits) })}</p>
    </div>
  );
}
