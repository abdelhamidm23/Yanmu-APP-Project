import { getTranslations } from "next-intl/server";
import { asc, eq, sql } from "drizzle-orm";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { branchRoutineCategory, expenseCategory } from "@/db/schema";
import { requireMoney } from "@/lib/require-user";
import { DECIDER_ROLES, hasRoleIn } from "@/lib/permissions";
import { formatPiastres } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, pickBranch } from "@/components/children/BranchTabs";
import { MoneyResult } from "@/components/money/Money";
import { saveRoutine } from "./actions";

/** Expense categories and each branch's routine list (spec §8.6, §17.1). */
export default async function ExpenseSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; ok?: string; done?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "fees");
  const t = await getTranslations("money.expenseSettings");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, DECIDER_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const categories = await tx.select().from(expenseCategory).orderBy(asc(expenseCategory.sort));
    const routine = new Set(
      (await tx.select({ id: branchRoutineCategory.categoryId }).from(branchRoutineCategory).where(eq(branchRoutineCategory.branchId, b.id))).map((r) => r.id),
    );
    const [lim] = (await tx.execute(sql`
      select app_setting_bigint(${b.id}, 'approvals.branch_manager_limit_piastres', 2000000)::text as "limit",
        coalesce((app_setting(${b.id}, 'approvals.unusual_multiplier') #>> '{}'), '2') as mult`)) as unknown as { limit: string; mult: string }[];
    return { branches, b, categories, routine, limit: BigInt(lim.limit), mult: lim.mult };
  });
  if (!data) return <Card>{tm("noBranch")}</Card>;
  const { branches, b, categories, routine, limit, mult } = data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help", { limit: formatPiastres(limit, loc, user.digits), mult })} />
      <BranchTabs branches={branches} current={b.id} path="/settings/expenses" locale={locale} label={tm("branch")} />
      <MoneyResult searchParams={sp} />
      <Card>
        <form action={saveRoutine} className="flex flex-col gap-1">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="branchId" value={b.id} />
          <fieldset>
            <legend className="mb-2 font-semibold">{t("routineList")}</legend>
            {categories.map((c) => (
              <label key={c.id} className="flex min-h-11 items-center gap-3">
                <input type="checkbox" name="routine" value={c.id} defaultChecked={routine.has(c.id)} className="size-5" />
                <span>{loc === "ar" ? c.nameAr : c.nameEn}</span>
              </label>
            ))}
          </fieldset>
          <p className="text-meta text-muted">{t("routineNote")}</p>
          <div className="mt-2">
            <Button type="submit">{t("save")}</Button>
          </div>
        </form>
      </Card>
      <p className="text-meta text-muted">{t("limitsNote")}</p>
    </div>
  );
}
