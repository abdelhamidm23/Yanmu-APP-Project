import { getTranslations } from "next-intl/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { importBatch, staff, staffAttendanceDay } from "@/db/schema";
import { requireArea } from "@/lib/require-user";
import { canImportPunches, hasRoleIn } from "@/lib/permissions";
import { cairoTimeOf, todayInCairo } from "@/lib/calendar";
import { formatNumber, formatPlainDate, formatTimestamp } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { ResultBanner } from "@/components/settings/ResultBanner";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";
import { PunchImportForm } from "./PunchImportForm";
import { isDemoMode } from "@/lib/demo";
import { rollbackPunchImport } from "./actions";

/** Staff attendance (spec §8.3): fingerprint file upload, the day's result per person, and past files with undo. */
export default async function StaffAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; date?: string; ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireArea(locale, "staff-attendance");
  const t = await getTranslations("staffAttendance");
  const loc = locale === "en" ? "en" : "ar";
  const n = (v: number) => formatNumber(v, loc, user.digits);
  const today = todayInCairo();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, ["owner", "company_manager", "branch_manager", "hr"], b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const people = await tx
      .select({
        id: staff.id,
        fullNameAr: staff.fullNameAr,
        fullNameEn: staff.fullNameEn,
        jobTitle: staff.jobTitle,
        no: staff.deviceEmployeeNo,
        status: staffAttendanceDay.status,
        firstIn: staffAttendanceDay.firstIn,
        lastOut: staffAttendanceDay.lastOut,
      })
      .from(staff)
      .leftJoin(staffAttendanceDay, and(eq(staffAttendanceDay.staffId, staff.id), eq(staffAttendanceDay.date, date)))
      .where(and(eq(staff.branchId, b.id), eq(staff.status, "active")))
      .orderBy(asc(staff.fullNameEn));
    const batches = await tx
      .select({ id: importBatch.id, fileName: importBatch.fileName, rowCount: importBatch.rowCount, status: importBatch.status, createdAt: importBatch.createdAt })
      .from(importBatch)
      .where(and(eq(importBatch.branchId, b.id), eq(importBatch.kind, "staff_punches")))
      .orderBy(desc(importBatch.createdAt))
      .limit(10);
    return { branches, b, people, batches };
  });
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("title")} />
        <Card>{t("noBranch")}</Card>
      </div>
    );
  }
  const { branches, b, people, batches } = data;
  const canUpload = canImportPunches(user, b.id);
  const counted = people.filter((p) => p.status);
  const present = people.filter((p) => p.status === "present" || p.status === "late").length;
  const late = people.filter((p) => p.status === "late").length;
  const absent = people.filter((p) => p.status === "absent").length;
  const tone = (s: string | null) => (s === "present" ? "good" : s === "late" ? "attention" : s === "absent" ? "critical" : "neutral") as "good";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")} />
      <BranchTabs branches={branches} current={b.id} path="/staff-attendance" locale={locale} label={t("branch")} />
      <ResultBanner searchParams={sp} />
      {canUpload ? <PunchImportForm branchId={b.id} sampleHref={isDemoMode() ? `/api/import-template/staff-punches?branch=${b.id}` : undefined} /> : null}

      <Card className="flex flex-col gap-3" data-testid="staff-day">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-section-title font-semibold">{t("dayTitle", { date: formatPlainDate(date, loc, user.digits) })}</h2>
          <form method="get" className="flex items-end gap-2">
            <input type="hidden" name="branch" value={b.id} />
            <div className="flex flex-col gap-1">
              <label htmlFor="day" className="text-[13px] font-medium text-subtle">
                {t("pickDay")}
              </label>
              <input id="day" name="date" type="date" max={today} defaultValue={date} className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]" />
            </div>
            <button type="submit" className={buttonClasses("secondary")}>
              {t("show")}
            </button>
          </form>
        </div>
        <p className="figure text-[15px]" data-testid="staff-present">
          {counted.length ? t("dayFigure", { present: n(present), staff: n(people.length), late: n(late), absent: n(absent) }) : t("noData")}
        </p>
        <ul className="flex flex-col divide-y divide-border">
          {people.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]" data-staff={p.fullNameEn}>
              <span className="flex flex-col">
                <span className="font-medium">{locale === "ar" ? p.fullNameAr : p.fullNameEn}</span>
                <span className="text-meta text-muted">
                  {p.jobTitle} · {p.no ? t("deviceNo", { no: p.no }) : t("noDeviceNo")}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {p.firstIn ? <span className="figure text-muted">{t("inOut", { in: cairoTimeOf(p.firstIn), out: p.lastOut ? cairoTimeOf(p.lastOut) : "—" })}</span> : null}
                <Flag tone={tone(p.status)}>{p.status ? t(`status.${p.status as "present"}`) : t("status.none")}</Flag>
              </span>
            </li>
          ))}
        </ul>
        <a href={`/api/export/staff-days?branch=${b.id}&date=${date}&locale=${loc}`} className={`${buttonClasses("secondary")} self-start`} data-testid="export-staff-days">
          {t("export")}
        </a>
      </Card>

      {batches.length ? (
        <Card className="flex flex-col gap-2" data-testid="punch-batches">
          <h2 className="text-section-title font-semibold">{t("filesTitle")}</h2>
          <ul className="flex flex-col divide-y divide-border">
            {batches.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
                <span className="flex flex-col">
                  <span className="font-medium">{x.fileName}</span>
                  <span className="figure text-meta text-muted">
                    {formatTimestamp(x.createdAt, loc, user.digits)} · {t("punches", { count: x.rowCount, n: n(x.rowCount) })}
                    {x.status === "rolled_back" ? ` · ${t("undone")}` : ""}
                  </span>
                </span>
                {canUpload && x.status === "committed" ? (
                  <form action={rollbackPunchImport}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="branchId" value={b.id} />
                    <input type="hidden" name="batchId" value={x.id} />
                    <button type="submit" className={buttonClasses("secondary")} data-testid="undo-file">
                      {t("undo")}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
