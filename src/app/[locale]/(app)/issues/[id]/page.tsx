import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { branchPeople, issueDetail } from "@/db/safety";
import { ISSUE_PRIORITIES } from "@/db/schema";
import { requireUser } from "@/lib/require-user";
import { canManageSafety } from "@/lib/permissions";
import { formatTimestamp } from "@/lib/format";
import { todayInCairo } from "@/lib/calendar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { Flag } from "@/components/children/BranchTabs";
import { PriorityFlag, SafetyResult } from "@/components/safety/Safety";
import { moveIssue, planIssue } from "../actions";

/** One issue: what is wrong, who does it by when, and moving it to done (spec §8.8). */
export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ok?: string; done?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations("safety");
  const loc = locale === "en" ? "en" : "ar";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withUserDb(user.id, async (tx) => {
    const i = await issueDetail(tx, id);
    if (!i) return null;
    const manager = canManageSafety(user, i.branchId);
    return { i, manager, people: manager ? await branchPeople(tx, i.branchId) : [] };
  });
  if (!data) notFound();
  const { i, manager, people } = data;
  const mover = manager || i.assignedTo === user.id;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="issueId" value={i.id} />
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/issues?branch=${i.branchId}`} className="text-brand underline">{t("issues.back")}</Link>
      <PageHeader title={i.title}>
        <span className="flex flex-wrap gap-2">
          <PriorityFlag priority={i.priority} />
          <Flag tone={i.status === "resolved" ? "good" : "neutral"} testId="issue-status">{t(`issues.status.${i.status}` as "issues.status.open")}</Flag>
          {i.overdue ? <Flag tone="critical">{t("issues.overdue")}</Flag> : null}
          {i.isDemo ? <Flag tone="neutral">{t("demo")}</Flag> : null}
        </span>
      </PageHeader>
      <SafetyResult searchParams={sp} />
      <Card className="flex flex-col gap-2">
        <p className="text-meta text-muted">
          {loc === "ar" ? i.branchAr : i.branchEn} · {t(`issues.category.${i.category}` as "issues.category.other")}
        </p>
        {i.details ? <p className="whitespace-pre-wrap">{i.details}</p> : null}
        <p className="figure text-meta text-muted">{t("issues.reportedBy", { name: i.reporter ?? "—", when: formatTimestamp(new Date(i.createdAt), loc, user.digits) })}</p>
        <p className="text-[15px]">
          {t("issues.assignedTo")}: <span className="font-medium">{i.assignee ?? t("issues.unassigned")}</span> · {t("issues.dueOn")}:{" "}
          <span className="figure">{i.dueOn ?? t("issues.noDue")}</span>
        </p>
        {i.photo ? (
          <a href={`/api/attachment/${i.photo}`} target="_blank" rel="noreferrer" className="self-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/attachment/${i.photo}`} alt={t("issues.photo")} className="max-h-64 rounded-button border border-border object-contain" />
          </a>
        ) : null}
        {i.resolvedAt ? (
          <p className="text-verified-fg">
            ✓ {t("issues.resolved", { name: i.resolvedBy ?? "—", when: formatTimestamp(new Date(i.resolvedAt), loc, user.digits) })}
            {i.resolutionNote ? <span className="block whitespace-pre-wrap text-muted">{i.resolutionNote}</span> : null}
          </p>
        ) : null}
      </Card>

      {manager && i.status !== "resolved" ? (
        <Card>
          <h2 className="mb-3 text-section-title font-semibold">{t("issues.manage")}</h2>
          <form action={planIssue} className="grid gap-3 sm:grid-cols-3">
            {hidden}
            <SelectField
              id="p-assignee"
              name="assignedTo"
              label={t("issues.assignedTo")}
              defaultValue={i.assignedTo ?? ""}
              options={[{ value: "", label: t("issues.unassigned") }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
            />
            <Field id="p-due" name="dueOn" type="date" label={t("issues.dueOn")} defaultValue={i.dueOn ?? ""} min={i.dueOn && i.dueOn < todayInCairo() ? i.dueOn : todayInCairo()} />
            <SelectField id="p-pri" name="priority" label={t("issues.priorityField")} defaultValue={i.priority} options={ISSUE_PRIORITIES.map((p) => ({ value: p, label: t(`issues.priority.${p}`) }))} />
            <div className="sm:col-span-3">
              <Button type="submit" variant="secondary" data-testid="plan-issue">{t("issues.saveAssign")}</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {mover ? (
        <Card className="flex flex-col gap-3">
          {i.status === "open" ? (
            <form action={moveIssue}>
              {hidden}
              <input type="hidden" name="status" value="in_progress" />
              <Button type="submit" variant="secondary" data-testid="start-issue">{t("issues.start")}</Button>
            </form>
          ) : null}
          {i.status !== "resolved" ? (
            <form action={moveIssue} className="flex flex-col gap-2">
              {hidden}
              <input type="hidden" name="status" value="resolved" />
              <label htmlFor="m-note" className="text-[13px] font-medium text-subtle">{t("issues.resolutionNote")}</label>
              <textarea id="m-note" name="note" rows={2} maxLength={2000} className="min-h-11 w-full rounded-button border border-outline bg-surface p-3 text-[15px] text-ink" />
              <Button type="submit" variant="success" className="self-start" data-testid="resolve-issue">{t("issues.resolve")}</Button>
            </form>
          ) : (
            <form action={moveIssue}>
              {hidden}
              <input type="hidden" name="status" value="open" />
              <Button type="submit" variant="secondary">{t("issues.reopen")}</Button>
            </form>
          )}
        </Card>
      ) : null}
    </div>
  );
}
