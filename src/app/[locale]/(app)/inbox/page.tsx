import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { approvalTrail, openMoneyRequests, type InboxItem } from "@/db/money";
import { requireMoney } from "@/lib/require-user";
import { myTurnToDecide, canSeeChildApprovals } from "@/lib/permissions";
import { formatTimestamp } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { Flag } from "@/components/children/BranchTabs";
import { Amount, MoneyResult } from "@/components/money/Money";
import { ApprovalTrail } from "@/components/money/ApprovalTrail";
import { decide } from "./actions";

/** Inbox (spec §8.6, §11.1): money approvals waiting for a decision, and the person's own requests. */
export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ok?: string; done?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "inbox");
  const t = await getTranslations("money.inbox");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";

  const items = await withUserDb(user.id, async (tx) => {
    const open = await openMoneyRequests(tx);
    return Promise.all(open.map(async (r) => ({ r, trail: (await approvalTrail(tx, r.id))!, turn: myTurnToDecide(user, r) })));
  });
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
      <PageHeader title={t("title")} help={t("help")} />
      <MoneyResult searchParams={sp} />
      {canSeeChildApprovals(user) ? (
        <Link href="/children/approvals" className="text-brand underline">{t("childApprovals")}</Link>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="inbox-mine">
        <h2 id="inbox-mine" className="text-section-title font-semibold">
          {t("forYou")} {mineToDecide.length ? <Flag tone="attention">{mineToDecide.length}</Flag> : null}
        </h2>
        {mineToDecide.length === 0 ? <Card>{t("nothingForYou")}</Card> : mineToDecide.map((x) => <Item key={x.r.id} x={x} />)}
      </section>

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
