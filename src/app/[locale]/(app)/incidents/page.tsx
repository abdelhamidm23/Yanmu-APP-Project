import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { INCIDENT_VIEWS, listIncidents, type IncidentView } from "@/db/safety";
import { requireSafety } from "@/lib/require-user";
import { SAFETY_REPORTER_ROLES, SAFETY_VIEW_ROLES, canReportSafety, canViewSafety, hasRoleIn } from "@/lib/permissions";
import { formatTimestamp } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";
import { IncidentStatusFlag, SafetyResult, SeverityFlag, ViewTabs } from "@/components/safety/Safety";

/** Incidents of a branch (spec §8.7). Managers see all; teachers and front desk see the ones they reported (RLS). */
export default async function IncidentsPage({
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
  const view: IncidentView = (INCIDENT_VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as IncidentView) : "open";

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, [...SAFETY_VIEW_ROLES, ...SAFETY_REPORTER_ROLES], b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    return { branches, b, rows: await listIncidents(tx, b.id, view) };
  });
  if (!data) return <Card>{t("noBranch")}</Card>;
  const { branches, b, rows } = data;
  const viewer = canViewSafety(user, b.id);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("incidents.title")} help={viewer ? t("incidents.help") : t("incidents.mineHelp")}>
        {canReportSafety(user, b.id) ? (
          <Link href={`/incidents/new?branch=${b.id}`} className={buttonClasses("danger")} data-testid="report-incident">{t("incidents.report")}</Link>
        ) : null}
      </PageHeader>
      <BranchTabs branches={branches} current={b.id} path="/incidents" locale={locale} label={t("branch")} />
      <SafetyResult searchParams={sp} />
      <ViewTabs
        views={INCIDENT_VIEWS}
        current={view}
        label={t("incidents.title")}
        hrefFor={(v) => `/incidents?branch=${b.id}&view=${v}`}
        labelFor={(v) => t(`incidents.views.${v}` as "incidents.views.open")}
      />
      {rows.length === 0 ? <Card>{t("incidents.empty")}</Card> : null}
      {rows.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="incident-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/incidents/${r.id}`} className="flex min-h-14 flex-col gap-1 px-4 py-3 hover:bg-bg">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.fromPickup ? t("incidents.fromPickup") : t(`category.${r.category}` as "category.other")}</span>
                  <SeverityFlag severity={r.severity} />
                  <IncidentStatusFlag status={r.status} />
                  {!r.seenAt && r.status === "open" && viewer ? <Flag tone="attention">{t("incidents.notSeen")}</Flag> : null}
                  {r.isDemo ? <Flag tone="neutral">{t("demo")}</Flag> : null}
                </span>
                <span className="line-clamp-2 text-[14px] text-subtle">{r.description}</span>
                <span className="figure text-meta text-muted">
                  {formatTimestamp(new Date(r.occurredAt), loc, user.digits)}
                  {r.roomAr ? ` · ${loc === "ar" ? r.roomAr : r.roomEn}` : ""} · {r.reporter ?? "—"} ·{" "}
                  {t("incidents.children", { count: r.children, n: String(r.children) })}
                  {r.openActions ? ` · ${t("incidents.openActions", { count: r.openActions, n: String(r.openActions) })}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {viewer ? (
        <a href={`/api/export/incidents?locale=${locale}&branch=${b.id}&view=${view}`} className={`${buttonClasses("secondary")} self-start`}>{t("export")}</a>
      ) : null}
    </div>
  );
}
