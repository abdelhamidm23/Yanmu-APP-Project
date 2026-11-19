import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { branchRoomsToday, lastPunchImport, openRefusals, roomsBreachedSince, stillCheckedIn } from "@/db/attendance";
import { readOrgSettings } from "@/db/settings";
import { requireArea } from "@/lib/require-user";
import { canEditRoster, canImportPunches, hasRoleIn } from "@/lib/permissions";
import { stillInAlertTime } from "@/lib/attendance";
import { cairoTimeOf, cairoWallToUtc, minutesOf, todayInCairo } from "@/lib/calendar";
import { formatNumber, formatPlainDate, formatTimestamp } from "@/lib/format";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { ResultBanner } from "@/components/settings/ResultBanner";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";
import { PickupScan } from "@/components/attendance/PickupScan";
import { acknowledgeRefusal } from "./actions";

/** Branch manager / front desk — Today (spec §11.6). Phase 3 parts: roll call, ratios, roster, staff file, pickups. */
export default async function TodayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireArea(locale, "today");
  const t = await getTranslations("today");
  const loc = locale === "en" ? "en" : "ar";
  const n = (v: number) => formatNumber(v, loc, user.digits);
  const date = todayInCairo();
  const [y, m, d] = date.split("-").map(Number);
  const startOfDay = cairoWallToUtc(y, m, d);

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, ["branch_manager", "front_desk"], b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const manager = canEditRoster(user, b.id);
    const [rooms, refusals, stillIn, lastFile, settings, breachedToday] = await Promise.all([
      branchRoomsToday(tx, b.id, date, { roster: manager }),
      openRefusals(tx, b.id, startOfDay),
      stillCheckedIn(tx, b.id, date),
      manager ? lastPunchImport(tx, b.id) : Promise.resolve(null),
      readOrgSettings(tx),
      manager ? roomsBreachedSince(tx, b.id, startOfDay) : Promise.resolve([] as string[]),
    ]);
    return { branches, b, manager, rooms, refusals, stillIn, lastFile, breachedToday, until: stillInAlertTime(String(settings.get("attendance.closing_time") ?? "16:00"), Number(settings.get("attendance.after_school_minutes") ?? 60)) };
  });
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("title")} />
        <Card>{t("noBranch")}</Card>
      </div>
    );
  }
  const { branches, b, manager, rooms, refusals, stillIn, lastFile, breachedToday, until } = data;
  const present = rooms.reduce((s, r) => s + r.present, 0);
  // Rule 1: children not marked yet are not counted as absent; the roll-call line shows what is missing.
  const expected = rooms.reduce((s, r) => s + r.present + r.absent, 0);
  const withChildren = rooms.filter((r) => r.enrolled > 0);
  const rollDone = withChildren.filter((r) => r.complete).length;
  const percent = expected ? Math.round((present / expected) * 100) : 0;
  const breaches = rooms.filter((r) => r.ratio.state === "breach");
  // Rooms that fell short earlier today and are fine now still count for the day (spec §16).
  const earlier = rooms.filter((r) => r.ratio.state !== "breach" && breachedToday.includes(r.id));
  const STILL_IN_NAMES = 10;
  const lateNow = minutesOf(cairoTimeOf(new Date())) >= minutesOf(until);
  const openRefusalsCount = refusals.filter((r) => !r.acknowledgedAt).length;
  const q = `branch=${b.id}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={`${localName(b, locale)} · ${formatPlainDate(date, loc, user.digits)}`} />
      <BranchTabs branches={branches} current={b.id} path="/today" locale={locale} label={t("branch")} />
      <ResultBanner searchParams={sp} />

      <PickupScan locale={locale} branchId={b.id} />

      {openRefusalsCount ? (
        <Card className="flex flex-col gap-2 border-critical" data-testid="refusals">
          <h2 className="text-section-title font-semibold text-critical">{t("refusalsTitle", { count: openRefusalsCount, n: n(openRefusalsCount) })}</h2>
          <ul className="flex flex-col gap-2">
            {refusals
              .filter((r) => !r.acknowledgedAt)
              .map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
                  <span>
                    {t("refusalLine", {
                      child: locale === "ar" ? r.fullNameAr : r.fullNameEn,
                      person: r.personName || t("unknownPerson"),
                      time: formatTimestamp(r.happenedAt, loc, user.digits),
                    })}
                    {r.note ? ` · ${r.note}` : ""}
                  </span>
                  {manager ? (
                    <form action={acknowledgeRefusal}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="branchId" value={b.id} />
                      <input type="hidden" name="refusalId" value={r.id} />
                      <button type="submit" className={buttonClasses("secondary")} data-testid="ack-refusal">
                        {t("acknowledge")}
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
          </ul>
        </Card>
      ) : null}

      {lateNow && stillIn.length ? (
        <Alert>
          {t("stillIn", { count: stillIn.length, n: n(stillIn.length), until })}{" "}
          {stillIn
            .slice(0, STILL_IN_NAMES)
            .map((c) => (locale === "ar" ? c.fullNameAr : c.fullNameEn))
            .join(locale === "ar" ? "، " : ", ")}
          {stillIn.length > STILL_IN_NAMES ? ` ${t("andMore", { n: n(stillIn.length - STILL_IN_NAMES) })}` : ""}
        </Alert>
      ) : null}

      <Card className="flex flex-col gap-3" data-testid="attendance-today">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-section-title font-semibold">{t("attendanceTitle")}</h2>
          <span className="figure text-[15px]" data-testid="attendance-figure">
            {expected ? t("attendanceFigure", { present: n(present), expected: n(expected), percent: n(percent) }) : "—"}
          </span>
        </div>
        <p className="figure text-meta text-muted">{t("rollCoverage", { done: n(rollDone), rooms: n(withChildren.length) })}</p>
        <ul className="flex flex-col divide-y divide-border">
          {rooms.map((r) => (
            <li key={r.id}>
              <Link href={`/roll-call/${r.id}`} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2 hover:bg-bg" data-testid="today-room">
                <span className="font-medium">{localName(r, locale)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {r.enrolled === 0 ? (
                    <span className="text-meta text-muted">{t("noChildren")}</span>
                  ) : r.complete ? (
                    <span className="figure text-meta">{t("roomPresent", { present: n(r.present), expected: n(r.expected) })}</span>
                  ) : (
                    <Flag tone="attention">{t("rollMissing", { count: r.notMarked, n: n(r.notMarked) })}</Flag>
                  )}
                  {manager && r.enrolled > 0 ? (
                    r.ratio.state === "breach" ? (
                      <Flag tone="critical" testId="ratio-breach">
                        {t("ratioBreach", { carers: n(r.carersConfirmed), required: n(r.ratio.required) })}
                      </Flag>
                    ) : r.ratio.state === "unconfirmed" ? (
                      <Flag tone="attention" testId="ratio-unconfirmed">
                        {t("ratioUnconfirmed", { carers: n(r.carersConfirmed), required: n(r.ratio.required) })}
                      </Flag>
                    ) : r.ratio.state === "ok" ? (
                      <Flag tone="good" testId="ratio-ok">
                        {t("ratioOk", { carers: n(r.carersConfirmed), required: n(r.ratio.required) })}
                      </Flag>
                    ) : null
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {manager ? (
        <Card className="flex flex-col gap-2" data-testid="team-today">
          <h2 className="text-section-title font-semibold">{t("teamTitle")}</h2>
          <p className="text-[14px]">
            {breaches.length ? <span className="text-critical">{t("breachCount", { count: breaches.length, n: n(breaches.length) })}</span> : t("noBreaches")}
          </p>
          {earlier.length ? (
            <p className="text-[14px] text-attention" data-testid="earlier-breaches">
              {t("earlierBreaches", { count: earlier.length, rooms: earlier.map((r) => localName(r, locale)).join(locale === "ar" ? "، " : ", ") })}
            </p>
          ) : null}
          <p className="text-[14px] text-subtle" data-testid="staff-file-status">
            {lastFile ? t("lastFile", { when: formatTimestamp(lastFile.createdAt, loc, user.digits), rows: n(lastFile.rowCount) }) : t("noFile")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/today/roster?${q}`} className={buttonClasses("secondary")} data-testid="open-roster">
              {t("roster")}
            </Link>
            {canImportPunches(user, b.id) ? (
              <Link href={`/staff-attendance?${q}`} className={buttonClasses("secondary")} data-testid="open-staff-file">
                {t("uploadStaffFile")}
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}

      <nav className="flex flex-wrap gap-2" aria-label={t("more")}>
        <Link href="/roll-call" className={buttonClasses("primary")}>
          {t("takeRollCall")}
        </Link>
        <Link href={`/children?${q}`} className={buttonClasses("secondary")}>
          {t("childAlerts")}
        </Link>
      </nav>
    </div>
  );
}
