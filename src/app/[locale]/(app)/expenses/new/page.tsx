import { getTranslations } from "next-intl/server";
import { asc, eq } from "drizzle-orm";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { branchRoutineCategory, expenseCategory } from "@/db/schema";
import { requireMoney } from "@/lib/require-user";
import { EXPENSE_ROLES, hasRoleIn } from "@/lib/permissions";
import { PAYMENT_METHODS } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";
import { formatPiastres } from "@/lib/format";
import { sql } from "drizzle-orm";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { BranchTabs, pickBranch } from "@/components/children/BranchTabs";
import { MoneyResult } from "@/components/money/Money";
import { recordExpense } from "../actions";

/** "+ Expense" (spec §8.6): routine spending counts at once; anything unusual goes to approval. */
export default async function NewExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "expense-new");
  const t = await getTranslations("money.expense");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, EXPENSE_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const categories = await tx.select().from(expenseCategory).orderBy(asc(expenseCategory.sort));
    const routine = new Set(
      (await tx.select({ id: branchRoutineCategory.categoryId }).from(branchRoutineCategory).where(eq(branchRoutineCategory.branchId, b.id))).map((r) => r.id),
    );
    const [lim] = (await tx.execute(sql`
      select app_setting_bigint(${b.id}, 'approvals.branch_manager_limit_piastres', 2000000)::text as "limit",
             app_setting_bigint(${b.id}, 'expenses.photo_required_from_piastres', 10000)::text as photo`)) as unknown as { limit: string; photo: string }[];
    return { branches, b, categories, routine, limit: BigInt(lim.limit), photo: BigInt(lim.photo) };
  });
  if (!data) return <Card>{tm("noBranch")}</Card>;
  const { branches, b, categories, routine, limit, photo } = data;
  const name = (c: { nameAr: string; nameEn: string }) => (loc === "ar" ? c.nameAr : c.nameEn);
  const egp = (v: bigint) => formatPiastres(v, loc, user.digits);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("newTitle")} help={t("newHelp", { limit: egp(limit) })} />
      <BranchTabs branches={branches} current={b.id} path="/expenses/new" locale={locale} label={tm("branch")} />
      <MoneyResult searchParams={sp} />
      <Card>
        <form action={recordExpense} className="grid gap-3 sm:grid-cols-2" data-testid="expense-form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="branchId" value={b.id} />
          <div className="sm:col-span-2">
            <SelectField
              id="exp-category"
              name="categoryId"
              label={t("category")}
              required
              options={[
                ...categories.filter((c) => routine.has(c.id)).map((c) => ({ value: c.id, label: `${name(c)} · ${t("routine")}` })),
                ...categories.filter((c) => !routine.has(c.id)).map((c) => ({ value: c.id, label: `${name(c)} · ${t("needsApproval")}` })),
              ]}
            />
          </div>
          <Field id="exp-amount" name="amount" label={t("amount")} inputMode="decimal" required />
          <SelectField id="exp-method" name="method" label={t("method")} options={PAYMENT_METHODS.map((m) => ({ value: m, label: tm(`methods.${m}`) }))} />
          <Field id="exp-date" name="spentOn" type="date" label={t("spentOn")} defaultValue={today} max={today} required />
          <Field id="exp-vendor" name="vendor" label={t("vendor")} maxLength={120} />
          <div className="sm:col-span-2">
            <Field id="exp-desc" name="description" label={t("description")} required minLength={2} maxLength={500} />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="exp-receipt" className="text-[13px] font-medium text-subtle">{t("receipt")}</label>
            <input id="exp-receipt" name="receipt" type="file" accept="image/*,application/pdf" capture="environment" className="min-h-11 text-[14px]" />
            <p className="text-meta text-muted">{t("receiptHint", { amount: egp(photo) })}</p>
          </div>
          <div className="sm:col-span-2">
            <Field id="exp-flag" name="flaggedNote" label={t("flagged")} maxLength={500} hint={t("flaggedHint")} />
          </div>
          <label className="flex min-h-11 items-center gap-3 sm:col-span-2">
            <input type="checkbox" name="isRequest" className="size-5" />
            <span>
              {t("isRequest")}
              <span className="block text-meta text-muted">{t("isRequestHint")}</span>
            </span>
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" full data-testid="save-expense">{t("save")}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
