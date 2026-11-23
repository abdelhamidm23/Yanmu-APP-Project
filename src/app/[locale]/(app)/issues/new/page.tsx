import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { ISSUE_CATEGORIES, ISSUE_PRIORITIES } from "@/db/schema";
import { requireSafety } from "@/lib/require-user";
import { SAFETY_REPORTER_ROLES, hasRoleIn } from "@/lib/permissions";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { SafetyResult } from "@/components/safety/Safety";
import { createIssue } from "../actions";

/** Report an issue: what is wrong, where, a photo (spec §8.8). */
export default async function NewIssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; ok?: string; done?: string; error?: string; id?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  if (sp.ok && sp.id && /^[0-9a-f-]{36}$/i.test(sp.id)) redirect({ href: `/issues/${sp.id}?ok=1&done=issueCreated`, locale });
  const user = await requireSafety(locale, "report");
  const t = await getTranslations("safety");
  const branches = await withUserDb(user.id, async (tx) => (await visibleBranches(tx)).filter((b) => hasRoleIn(user, SAFETY_REPORTER_ROLES, b.id)));
  if (branches.length === 0) return <Card>{t("noBranch")}</Card>;
  const current = branches.find((b) => b.id === sp.branch) ?? branches[0];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("issues.newTitle")} help={t("issues.newHelp")} />
      <SafetyResult searchParams={sp} />
      <Card>
        <form action={createIssue} className="flex flex-col gap-4" data-testid="issue-form">
          <input type="hidden" name="locale" value={locale} />
          {branches.length > 1 ? (
            <SelectField id="i-branch" name="branchId" label={t("branch")} defaultValue={current.id} options={branches.map((b) => ({ value: b.id, label: localName(b, locale) }))} />
          ) : (
            <input type="hidden" name="branchId" value={current.id} />
          )}
          <Field id="i-title" name="title" label={t("issues.titleField")} required minLength={3} maxLength={200} data-testid="issue-title" />
          <SelectField id="i-cat" name="category" label={t("issues.categoryField")} defaultValue="maintenance" options={ISSUE_CATEGORIES.map((c) => ({ value: c, label: t(`issues.category.${c}`) }))} />
          <SelectField id="i-pri" name="priority" label={t("issues.priorityField")} defaultValue="normal" options={ISSUE_PRIORITIES.map((p) => ({ value: p, label: t(`issues.priority.${p}`) }))} />
          <div className="flex flex-col gap-1">
            <label htmlFor="i-details" className="text-[13px] font-medium text-subtle">{t("issues.details")}</label>
            <textarea id="i-details" name="details" rows={3} maxLength={4000} className="min-h-11 w-full rounded-button border border-outline bg-surface p-3 text-[15px] text-ink" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="i-photo" className="text-[13px] font-medium text-subtle">{t("issues.photo")}</label>
            <input id="i-photo" name="photo" type="file" accept="image/*" capture="environment" className="min-h-11 text-[14px]" />
          </div>
          <Button type="submit" data-testid="save-issue">{t("issues.save")}</Button>
        </form>
      </Card>
    </div>
  );
}
