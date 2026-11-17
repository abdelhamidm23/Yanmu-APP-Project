import { asc, desc, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { withUserDb } from "@/db/rls";
import { academicYear, branch, calendarDay, term } from "@/db/schema";
import { readOrgSettings } from "@/db/settings";
import { requireSettings } from "@/lib/require-user";
import { isOrgAdmin } from "@/lib/permissions";
import { localName } from "@/lib/i18n-names";
import { formatPlainDate, type Locale } from "@/lib/format";
import { WEEKDAYS, type Weekday } from "@/lib/settings";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CheckField, Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { ResultBanner } from "@/components/settings/ResultBanner";
import { addAcademicYear, addException, addTerm, removeException, removeTerm, saveWorkingDays } from "./actions";

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const user = await requireSettings(locale, "calendar");
  const t = await getTranslations("settings");
  const admin = isOrgAdmin(user);
  const loc: Locale = locale === "en" ? "en" : "ar";

  const data = await withUserDb(user.id, async (tx) => {
    const branches = await tx.select().from(branch).orderBy(asc(branch.code));
    const ids = branches.map((b) => b.id);
    const exceptions = ids.length
      ? await tx.select().from(calendarDay).where(inArray(calendarDay.branchId, ids)).orderBy(desc(calendarDay.date)).limit(200)
      : [];
    const years = await tx.select().from(academicYear).orderBy(desc(academicYear.startsOn));
    const terms = await tx.select().from(term).orderBy(asc(term.startsOn));
    const settings = await readOrgSettings(tx);
    return { branches, exceptions, years, terms, settings };
  });

  const working = (data.settings.get("calendar.working_days") as Weekday[] | undefined) ?? ["sun", "mon", "tue", "wed", "thu"];
  // Branches this person may add holidays to: all for admins, managed branches for branch managers.
  const managed = admin
    ? data.branches
    : data.branches.filter((b) => user.grants.some((g) => g.role === "branch_manager" && g.branchId === b.id));
  const branchName = new Map(data.branches.map((b) => [b.id, localName(b, locale)]));
  const canRemove = (branchId: string) => managed.some((b) => b.id === branchId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("calendar.title")} />
      <ResultBanner searchParams={await searchParams} />

      <Card>
        <h2 className="text-section-title font-semibold">{t("calendar.workingDays")}</h2>
        <p className="mt-1 text-meta text-muted">{t("calendar.workingDaysHelp")}</p>
        <form action={saveWorkingDays} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="locale" value={locale} />
          <fieldset disabled={!admin} className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
            <legend className="sr-only">{t("calendar.workingDays")}</legend>
            {WEEKDAYS.map((d) => (
              <CheckField key={d} name="days" value={d} label={t(`calendar.days.${d}`)} defaultChecked={working.includes(d)} />
            ))}
          </fieldset>
          {admin ? (
            <Button type="submit" variant="secondary" className="self-start">
              {t("common.save")}
            </Button>
          ) : null}
        </form>
      </Card>

      <Card>
        <h2 className="text-section-title font-semibold">{t("calendar.exceptions")}</h2>
        <p className="mt-1 text-meta text-muted">{t("calendar.exceptionsHelp")}</p>
        {managed.length > 0 ? (
          <form action={addException} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="add-exception">
            <input type="hidden" name="locale" value={locale} />
            <SelectField id="ex-branch" name="branchId" label={t("common.branch")} options={managed.map((b) => ({ value: b.id, label: localName(b, locale) }))} />
            <Field id="ex-date" name="date" type="date" label={t("common.date")} required />
            <SelectField
              id="ex-kind"
              name="kind"
              label={t("calendar.kind")}
              options={[
                { value: "holiday", label: t("calendar.holiday") },
                { value: "extra", label: t("calendar.extraDay") },
              ]}
            />
            <Field id="ex-note" name="note" label={t("common.note")} maxLength={120} />
            <div>
              <Button type="submit">{t("calendar.addException")}</Button>
            </div>
          </form>
        ) : null}
        <ul className="mt-4 flex flex-col divide-y divide-divider" data-testid="exception-list">
          {data.exceptions.length === 0 ? <li className="py-2 text-muted">{t("common.none")}</li> : null}
          {data.exceptions.map((e) => (
            <li key={`${e.branchId}/${e.date}`} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="figure min-w-36 font-medium">{formatPlainDate(e.date, loc, user.digits)}</span>
              <span className={`rounded-chip px-2 py-0.5 text-meta font-medium ${e.isWorkingDay ? "bg-verified-bg text-verified-fg" : "bg-attention-bg text-attention"}`}>
                {e.isWorkingDay ? t("calendar.extraDay") : t("calendar.holiday")}
              </span>
              <span className="text-meta text-muted">{branchName.get(e.branchId)}</span>
              {e.note ? <span className="text-meta">{e.note}</span> : null}
              {canRemove(e.branchId) ? (
                <form action={removeException} className="ms-auto">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="branchId" value={e.branchId} />
                  <input type="hidden" name="date" value={e.date} />
                  <button type="submit" className="min-h-11 px-2 text-[14px] font-medium text-critical underline">
                    {t("common.remove")}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-section-title font-semibold">{t("calendar.academicYears")}</h2>
        <ul className="mt-3 flex flex-col gap-4">
          {data.years.length === 0 ? <li className="text-muted">{t("common.none")}</li> : null}
          {data.years.map((y) => (
            <li key={y.id} className="rounded-tile border border-divider p-3">
              <p className="font-semibold">
                {y.label}{" "}
                <span className="figure text-meta font-normal text-muted">
                  {formatPlainDate(y.startsOn, loc, user.digits)} – {formatPlainDate(y.endsOn, loc, user.digits)}
                </span>
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {data.terms
                  .filter((tm) => tm.academicYearId === y.id)
                  .map((tm) => (
                    <li key={tm.id} className="flex flex-wrap items-center gap-2 text-[14px]">
                      <span>{tm.label}</span>
                      <span className="figure text-meta text-muted">
                        {formatPlainDate(tm.startsOn, loc, user.digits)} – {formatPlainDate(tm.endsOn, loc, user.digits)}
                      </span>
                      {admin ? (
                        <form action={removeTerm} className="ms-auto">
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="id" value={tm.id} />
                          <button type="submit" className="min-h-11 px-2 text-[14px] font-medium text-critical underline">
                            {t("common.remove")}
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
              </ul>
              {admin ? (
                <form action={addTerm} className="mt-3 grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="academicYearId" value={y.id} />
                  <Field id={`t-${y.id}-label`} name="label" label={t("calendar.label")} required />
                  <Field id={`t-${y.id}-start`} name="startsOn" type="date" label={t("calendar.startsOn")} min={y.startsOn} max={y.endsOn} required />
                  <Field id={`t-${y.id}-end`} name="endsOn" type="date" label={t("calendar.endsOn")} min={y.startsOn} max={y.endsOn} required />
                  <div className="flex items-end">
                    <Button type="submit" variant="secondary">
                      {t("calendar.addTerm")}
                    </Button>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {admin ? (
          <form action={addAcademicYear} className="mt-4 grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="locale" value={locale} />
            <Field id="y-label" name="label" label={t("calendar.label")} placeholder="2026–2027" required />
            <Field id="y-start" name="startsOn" type="date" label={t("calendar.startsOn")} required />
            <Field id="y-end" name="endsOn" type="date" label={t("calendar.endsOn")} required />
            <div className="flex items-end">
              <Button type="submit">{t("calendar.addYear")}</Button>
            </div>
          </form>
        ) : null}
      </Card>
    </div>
  );
}
