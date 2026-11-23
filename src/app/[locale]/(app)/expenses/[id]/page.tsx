import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { approvalTrail } from "@/db/money";
import { requireMoney } from "@/lib/require-user";
import { canDecideMoney, canRecordExpense } from "@/lib/permissions";
import { todayInCairo } from "@/lib/calendar";
import { formatPlainDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Field, PageHeader } from "@/components/settings/Fields";
import { Flag } from "@/components/children/BranchTabs";
import { Amount, ExpenseStatus, MoneyResult } from "@/components/money/Money";
import { ApprovalTrail } from "@/components/money/ApprovalTrail";
import { answerQuestion, completeRequest, reverseExpense } from "../actions";

type E = {
  id: string; branchId: string; spentOn: string; amount: string; status: string; isRequest: boolean; isUnusual: boolean; description: string;
  flaggedNote: string | null; categoryAr: string; categoryEn: string; vendor: string | null; method: string; receipt: string | null;
  createdBy: string | null; byName: string | null; requestId: string | null; reverses: string | null; reversedBy: string | null; isDemo: boolean;
};

/** One expense: what, how much, the receipt, and its approval trail (spec §8.6). */
export default async function ExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ok?: string; done?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "expenses");
  const t = await getTranslations("money.expense");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const data = await withUserDb(user.id, async (tx) => {
    const [e] = (await tx.execute(sql`
      select e.id, e.branch_id as "branchId", to_char(e.spent_on, 'YYYY-MM-DD') as "spentOn", e.amount_piastres::text as amount, e.status,
        e.is_request as "isRequest", e.is_unusual as "isUnusual", e.description, e.flagged_note as "flaggedNote",
        c.name_ar as "categoryAr", c.name_en as "categoryEn", v.name as vendor, e.payment_method as method,
        e.receipt_attachment_id as receipt, e.created_by as "createdBy", u.full_name as "byName", e.approval_request_id as "requestId",
        e.reverses_expense_id as reverses, (select r.id from expense r where r.reverses_expense_id = e.id) as "reversedBy", e.is_demo as "isDemo"
      from expense e join expense_category c on c.id = e.category_id left join vendor v on v.id = e.vendor_id
      left join app_user u on u.id = e.created_by where e.id = ${id}`)) as unknown as E[];
    if (!e) return null;
    return { e, trail: e.requestId ? await approvalTrail(tx, e.requestId) : null };
  });
  if (!data) notFound();
  const { e, trail } = data;
  const amount = BigInt(e.amount);
  const mine = e.createdBy === user.id;
  const canWrite = canRecordExpense(user, e.branchId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${loc === "ar" ? e.categoryAr : e.categoryEn} · ${e.description}`}>
        <Link href={`/expenses?branch=${e.branchId}`} className="text-brand underline">{tm("links.expenses")}</Link>
      </PageHeader>
      <MoneyResult searchParams={sp} />
      <Card data-testid="expense">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-kpi font-semibold"><Amount value={amount} locale={locale} digits={user.digits} /></span>
          <span className="flex gap-2">
            {e.isDemo ? <Flag tone="attention">{tm("demo")}</Flag> : null}
            <ExpenseStatus status={e.status} isRequest={e.isRequest} reversal={!!e.reverses} />
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
          <dt className="text-subtle">{e.isRequest ? t("plannedOn") : t("spentOn")}</dt>
          <dd>{formatPlainDate(e.spentOn, loc, user.digits)}</dd>
          <dt className="text-subtle">{t("method")}</dt>
          <dd>{tm(`methods.${e.method}`)}</dd>
          <dt className="text-subtle">{t("vendor")}</dt>
          <dd>{e.vendor ?? "—"}</dd>
          <dt className="text-subtle">{t("by")}</dt>
          <dd>{e.byName ?? "—"}</dd>
          {e.flaggedNote ? (
            <>
              <dt className="text-subtle">{t("flagged")}</dt>
              <dd>{e.flaggedNote}</dd>
            </>
          ) : null}
          <dt className="text-subtle">{t("receipt")}</dt>
          <dd>{e.receipt ? <a href={`/api/attachment/${e.receipt}`} target="_blank" rel="noreferrer" className="text-brand underline">{t("openReceipt")}</a> : t("noReceipt")}</dd>
        </dl>
        {e.reverses ? <p className="mt-3 text-[14px]"><Link href={`/expenses/${e.reverses}`} className="text-brand underline">{t("reversesLink")}</Link></p> : null}
        {e.reversedBy ? <p className="mt-3 text-[14px]"><Link href={`/expenses/${e.reversedBy}`} className="text-brand underline">{t("reversedLink")}</Link></p> : null}
        {e.status === "recorded" && !e.reverses ? <p className="mt-3 text-meta text-muted">{t("routineNote")}</p> : null}
      </Card>

      {trail ? (
        <Card>
          <h2 className="text-section-title font-semibold">{t("approvalTitle")}</h2>
          <div className="mt-2">
            <ApprovalTrail request={trail.request} steps={trail.steps} locale={locale} digits={user.digits} />
          </div>
          {trail.request.status === "question" && mine ? (
            <form action={answerQuestion} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="expenseId" value={e.id} />
              <input type="hidden" name="requestId" value={trail.request.id} />
              <Field id="exp-answer" name="comment" label={t("answer")} required minLength={2} maxLength={1000} />
              <Button type="submit">{t("sendAnswer")}</Button>
            </form>
          ) : null}
          {trail.request.status === "pending" && canDecideMoney(user, e.branchId) && !mine ? (
            <Link href={`/inbox?branch=${e.branchId}#r-${trail.request.id}`} className={`${buttonClasses("primary")} mt-3`}>{t("decideInInbox")}</Link>
          ) : null}
        </Card>
      ) : null}

      {e.isRequest && e.status === "approved" && canWrite ? (
        <Card>
          <h2 className="text-section-title font-semibold">{t("completeTitle")}</h2>
          <p className="mt-1 text-[14px] text-subtle">{t("completeHelp")}</p>
          <form action={completeRequest} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="expenseId" value={e.id} />
            <Field id="exp-done-on" name="spentOn" type="date" label={t("spentOn")} defaultValue={todayInCairo()} max={todayInCairo()} required />
            <div className="flex flex-col gap-1">
              <label htmlFor="exp-done-receipt" className="text-[13px] font-medium text-subtle">{t("receipt")}</label>
              <input id="exp-done-receipt" name="receipt" type="file" required accept="image/*,application/pdf" capture="environment" className="min-h-11 text-[14px]" />
            </div>
            <Button type="submit">{t("complete")}</Button>
          </form>
        </Card>
      ) : null}

      {!e.isRequest && !e.reverses && (e.status === "recorded" || e.status === "approved") && canWrite ? (
        <Card>
          <h2 className="text-section-title font-semibold">{t("reverseTitle")}</h2>
          <p className="mt-1 text-[14px] text-subtle">{t("reverseHelp")}</p>
          <form action={reverseExpense} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="expenseId" value={e.id} />
            <Field id="exp-reverse" name="reason" label={t("reverseReason")} required minLength={3} maxLength={500} />
            <Button type="submit" variant="danger">{t("reverse")}</Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
