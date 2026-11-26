import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { ISSUE_VIEWS, listIssues, type IssueView } from "@/db/safety";
import { requireSafety } from "@/lib/require-user";
import { SAFETY_REPORTER_ROLES, SAFETY_VIEW_ROLES, canReportSafety, canViewSafety, hasRoleIn } from "@/lib/permissions";
import { formatPlainDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";
import { PriorityFlag, SafetyResult, ViewTabs } from "@/components/safety/Safety";

/** Maintenance, equipment and supply issues of a branch (spec §8.8). */
export default async function IssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; view?: string; ok?: string; done?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireSafety(locale, "open");
  const t = await getTranslations("safety");
  const loc = locale === "en" ? "en" : "ar";
  const view: IssueView = (ISSUE_VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as IssueView) : "open";

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, [...SAFETY_VIEW_ROLES, ...SAFETY_REPORTER_ROLES], b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    return { branches, b, rows: await listIssues(tx, b.id, view, user.id) };
  });
  if (!data) return <Card>{t("noBranch")}</Card>;
  const { branches, b, rows } = data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("issues.title")} help={t("issues.help")}>
        {canReportSafety(user, b.id) ? (
          <Link href={`/issues/new?branch=${b.id}`} className={buttonClasses("primary")} data-testid="report-issue">{t("issues.report")}</Link>
        ) : null}
      </PageHeader>
      <BranchTabs branches={branches} current={b.id} path="/issues" locale={locale} label={t("branch")} />
      <SafetyResult searchParams={sp} />
      <ViewTabs
        views={ISSUE_VIEWS}
        current={view}
        label={t("issues.title")}
        hrefFor={(v) => `/issues?branch=${b.id}&view=${v}`}
        labelFor={(v) => t(`issues.views.${v}` as "issues.views.open")}
      />
      {rows.length === 0 ? <Card>{t("issues.empty")}</Card> : null}
      {rows.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="issue-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/issues/${r.id}`} className="flex min-h-14 flex-col gap-1 px-4 py-3 hover:bg-bg">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.title}</span>
                  <PriorityFlag priority={r.priority} />
                  <Flag tone={r.status === "resolved" ? "good" : "neutral"}>{t(`issues.status.${r.status}` as "issues.status.open")}</Flag>
                  {r.overdue ? <Flag tone="critical">{t("issues.overdue")}</Flag> : null}
                  {r.isDemo ? <Flag tone="neutral">{t("demo")}</Flag> : null}
                </span>
                <span className="figure text-meta text-muted">
                  {t(`issues.category.${r.category}` as "issues.category.other")} · {r.assignee ?? t("issues.unassigned")} ·{" "}
                  {r.dueOn ? `${t("issues.dueOn")} ${formatPlainDate(r.dueOn, loc, user.digits)}` : t("issues.noDue")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {canViewSafety(user, b.id) ? (
        <a href={`/api/export/issues?locale=${locale}&branch=${b.id}&view=${view}`} className={`${buttonClasses("secondary")} self-start`}>{t("export")}</a>
      ) : null}
    </div>
  );
}
