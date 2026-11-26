import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { activeCount, branchRooms, childList, pendingApprovalCount, visibleBranches } from "@/db/children";
import { requireChildren } from "@/lib/require-user";
import { canEditChildren, canImportChildren, canSeeChildApprovals, canViewWaitlist } from "@/lib/permissions";
import { LEAVING_WINDOW_DAYS, MOVING_UP_WINDOW_DAYS, ageInMonths, childAlerts, occupancy } from "@/lib/children";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber, formatPlainDate } from "@/lib/format";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";

export default async function ChildrenPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; q?: string; room?: string; show?: string; ok?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireChildren(locale);
  const t = await getTranslations("children");
  const loc = locale === "en" ? "en" : "ar";
  const n = (v: number) => formatNumber(v, loc, user.digits);
  const d = (iso: string) => formatPlainDate(iso, loc, user.digits);
  const today = todayInCairo();
  const show = sp.show === "left" ? "left" : "current";

  const data = await withUserDb(user.id, async (tx) => {
    const branches = await visibleBranches(tx);
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const [rooms, children, active, pending] = await Promise.all([
      branchRooms(tx, b.id),
      childList(tx, b.id, { q: sp.q, roomId: sp.room || undefined, show }),
      activeCount(tx, b.id),
      pendingApprovalCount(tx, b.id),
    ]);
    return { branches, b, rooms, children, active, pending };
  });

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("title")} />
        <Card>{t("noBranch")}</Card>
      </div>
    );
  }
  const { branches, b, rooms, children, active, pending } = data;
  const occ = occupancy(active, b.licensed);
  const canEdit = canEditChildren(user, b.id);
  const rows = children.map((c) => ({ ...c, age: ageInMonths(c.dateOfBirth, today), alerts: childAlerts(c.dateOfBirth, c.bandMax ? { maxAgeMonths: c.bandMax } : null, today) }));
  const current = show === "current";
  const movingUp = current ? rows.filter((r) => r.alerts.movingUpOn).length : 0;
  const leaving = current ? rows.filter((r) => r.alerts.leavingOn).length : 0;
  const noConsent = current ? rows.filter((r) => !r.hasRecordsConsent).length : 0;
  const branchQuery = `branch=${b.id}`;
  const age = (months: number) => t("age", { years: n(Math.floor(months / 12)), months: n(months % 12) });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")}>
        {canEdit ? (
          <Link href={`/children/new?${branchQuery}`} className={buttonClasses("primary")} data-testid="add-child">
            {t("addChild")}
          </Link>
        ) : null}
      </PageHeader>
      <BranchTabs branches={branches} current={b.id} path="/children" locale={locale} label={t("branch")} />
      {sp.ok === "pending" ? <Alert tone="good">{t("form.savedPending")}</Alert> : sp.ok ? <Alert tone="good">{t("saved")}</Alert> : null}

      <Card className="flex flex-col gap-2" data-testid="occupancy">
        <p className="text-section-title font-semibold">{localName(b, locale)}</p>
        <p className="figure text-[15px]">
          {t("occupancy", { active: n(occ.active), licensed: n(occ.licensed), percent: n(occ.percent) })}
          <span className="text-muted"> · {t("physical", { physical: n(b.physical) })}</span>
        </p>
        <div className="h-2 w-full overflow-hidden rounded-chip bg-provisional-bg" aria-hidden>
          <div className={`h-full ${occ.atCap ? "bg-critical" : "bg-brand"}`} style={{ inlineSize: `${Math.min(occ.percent, 100)}%` }} />
        </div>
        {occ.atCap ? <p className="text-[14px] text-critical">{t("occupancyFull")}</p> : null}
      </Card>

      {movingUp + leaving + noConsent + pending > 0 ? (
        <Card className="flex flex-col gap-2" data-testid="child-alerts">
          <h2 className="text-section-title font-semibold">{t("alertsTitle")}</h2>
          <ul className="flex flex-col gap-1 text-[14px]">
            {noConsent ? <li className="text-critical">{t("alertNoConsent", { count: noConsent, n: n(noConsent) })}</li> : null}
            {pending ? (
              <li>
                <Link href={`/children/approvals?${branchQuery}`} className="text-brand underline">
                  {t("alertPending", { count: pending, n: n(pending) })}
                </Link>
              </li>
            ) : null}
            {movingUp ? <li>{t("alertMovingUp", { count: movingUp, n: n(movingUp), days: n(MOVING_UP_WINDOW_DAYS) })}</li> : null}
            {leaving ? <li>{t("alertLeaving", { count: leaving, n: n(leaving), days: n(LEAVING_WINDOW_DAYS) })}</li> : null}
          </ul>
        </Card>
      ) : null}

      <nav className="flex flex-wrap gap-2" aria-label={t("more")}>
        {canViewWaitlist(user) ? (
          <Link href={`/children/waitlist?${branchQuery}`} className={buttonClasses("secondary")}>
            {t("waitlist")}
          </Link>
        ) : null}
        {canSeeChildApprovals(user) ? (
          <Link href={`/children/approvals?${branchQuery}`} className={buttonClasses("secondary")}>
            {t("approvals")}
          </Link>
        ) : null}
        {canImportChildren(user) ? (
          <Link href={`/children/import?${branchQuery}`} className={buttonClasses("secondary")}>
            {t("import")}
          </Link>
        ) : null}
        <a href={`/api/export/children?${branchQuery}&show=${show}&locale=${loc}`} className={buttonClasses("secondary")} data-testid="export-children">
          {t("export")}
        </a>
      </nav>

      <form method="get" className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <input type="hidden" name="branch" value={b.id} />
        <div className="flex flex-col gap-1">
          <label htmlFor="child-q" className="text-[13px] font-medium text-subtle">
            {t("search")}
          </label>
          <input id="child-q" name="q" type="search" defaultValue={sp.q ?? ""} className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="child-room" className="text-[13px] font-medium text-subtle">
            {t("room")}
          </label>
          <select id="child-room" name="room" defaultValue={sp.room ?? ""} className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]">
            <option value="">{t("allRooms")}</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {localName(r, locale)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="child-show" className="text-[13px] font-medium text-subtle">
            {t("show")}
          </label>
          <select id="child-show" name="show" defaultValue={show} className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]">
            <option value="current">{t("showCurrent")}</option>
            <option value="left">{t("showLeft")}</option>
          </select>
        </div>
        <button type="submit" className={buttonClasses("secondary")}>
          {t("searchButton")}
        </button>
      </form>

      <p className="figure text-meta text-muted" data-testid="child-count">
        {t("count", { count: rows.length, n: n(rows.length) })}
      </p>
      {rows.length === 0 ? (
        <Card>
          <p className="text-muted">{sp.q || sp.room ? t("noMatch") : t("empty")}</p>
        </Card>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="child-list">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/children/${c.id}`} className="flex min-h-14 flex-col gap-1 px-4 py-3 hover:bg-bg" data-testid="child-row">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-row-title font-semibold">{locale === "ar" ? c.fullNameAr : c.fullNameEn}</span>
                  <span className="figure text-meta text-muted">{c.studentNo}</span>
                </span>
                <span className="figure text-meta text-subtle">
                  {age(c.age)}
                  {c.roomNameEn ? ` · ${locale === "ar" ? c.roomNameAr : c.roomNameEn}` : ""}
                  {!current ? ` · ${t(`status.${c.status as "withdrawn"}`)}` : ""}
                </span>
                {current ? (
                  <span className="flex flex-wrap gap-1">
                    {!c.hasRecordsConsent ? <Flag tone="critical" testId="flag-no-consent">{t("flags.noConsent")}</Flag> : null}
                    {c.enrollmentStatus === "pending_approval" ? <Flag tone="attention">{t("flags.pending")}</Flag> : null}
                    {c.alerts.movingUpOn ? <Flag tone="neutral">{t("flags.movingUp", { date: d(c.alerts.movingUpOn) })}</Flag> : null}
                    {c.alerts.leavingOn ? <Flag tone="attention">{t("flags.leaving", { date: d(c.alerts.leavingOn) })}</Flag> : null}
                    {c.bandOverride ? <Flag tone="neutral">{t("flags.bandOverride")}</Flag> : null}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
