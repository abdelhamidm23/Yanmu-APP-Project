import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { dailyClose, dayFacts, emptySection, recentDays, type DayFacts } from "@/db/closing";
import { DAILY_CLOSE_SECTIONS } from "@/db/schema";
import { requireClosing } from "@/lib/require-user";
import { CLOSE_VIEW_ROLES, DAY_CLOSE_ROLES, canCloseDay, hasRoleIn } from "@/lib/permissions";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber, formatPlainDate, formatTimestamp } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";
import { ClosingResult } from "@/components/closing/Closing";
import { DataStatusChip } from "@/components/closing/DataStatusChip";
import { closeDay } from "./actions";

type Section = (typeof DAILY_CLOSE_SECTIONS)[number];

/** Daily close (spec §8.9): the day assembled from records, one tap per section, then submitted. */
export default async function DailyClosePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; date?: string; ok?: string; done?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireClosing(locale, "day");
  const t = await getTranslations("closing.day");
  const tc = await getTranslations("closing");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, [...CLOSE_VIEW_ROLES, ...DAY_CLOSE_ROLES], b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const [w] = (await tx.execute(sql`select is_working_day(${b.id}, ${date}::date) as w`)) as unknown as { w: boolean }[];
    const [due] = (await tx.execute(sql`select coalesce(app_setting(${b.id}, 'daily_close.due_time') #>> '{}', '19:00') as v`)) as unknown as { v: string }[];
    const closed = await dailyClose(tx, b.id, date);
    const facts = await dayFacts(tx, b.id, date);
    const recent = await recentDays(tx, b.id, today, 21);
    return { branches, b, working: w.w, due: due.v, closed, facts, recent };
  });
  if (!data) return <Card>{tc("noBranch")}</Card>;
  const { branches, b, working, due, closed, facts, recent } = data;
  const canClose = canCloseDay(user, b.id);
  const n = (v: number) => formatNumber(v, loc, user.digits);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help", { time: due })} />
      <BranchTabs branches={branches} current={b.id} path="/daily-close" locale={locale} label={tc("branch")} />
      <ClosingResult searchParams={sp} />

      <form method="get" action={`/${locale}/daily-close`} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="branch" value={b.id} />
        <div className="flex flex-col gap-1">
          <label htmlFor="dc-date" className="text-[13px] font-medium text-subtle">{t("dateLabel")}</label>
          <input id="dc-date" name="date" type="date" defaultValue={date} max={today} className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]" />
        </div>
        <Button type="submit" variant="secondary">{t("show")}</Button>
      </form>

      <Card data-testid="day-status">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-section-title font-semibold">{formatPlainDate(date, loc, user.digits)}</h2>
          {closed ? (
            <span className="flex gap-2">
              <DataStatusChip status="confirmed" />
              {closed.isLate ? <Flag tone="attention">{t("late")}</Flag> : null}
            </span>
          ) : working ? (
            <DataStatusChip status="incomplete" />
          ) : null}
        </div>
        <p className="mt-1 text-[14px] text-subtle">
          {closed
            ? t("closedBy", { name: closed.closedBy ?? "—", when: formatTimestamp(new Date(closed.closedAt), loc, user.digits) })
            : !working
              ? t("notWorking")
              : canClose
                ? t("notClosedYou")
                : t("notClosedView")}
        </p>
      </Card>

      {closed ? (
        <ul className="flex flex-col gap-3" data-testid="day-closed">
          {DAILY_CLOSE_SECTIONS.map((s) => {
            const st = closed.sections[s];
            const f = (st?.facts as DayFacts[Section] | undefined) ?? facts[s];
            return (
              <li key={s}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{t(`sections.${s}`)}</h3>
                    <Flag tone={st?.state === "fix" ? "attention" : "good"}>{t(`answer.${st?.state ?? "correct"}`)}</Flag>
                  </div>
                  <p className="mt-1 text-[14px] text-subtle figure">{factLine(s, { ...facts, [s]: f } as DayFacts, t, n)}</p>
                  <p className="mt-1 text-[14px]">{question(s, { ...facts, [s]: f } as DayFacts, t)}</p>
                  {st?.note ? <p className="mt-2 text-[14px]">{st.note}</p> : null}
                </Card>
              </li>
            );
          })}
          {closed.notes ? (
            <li>
              <Card>
                <h3 className="font-semibold">{t("managerNotes")}</h3>
                <p className="mt-1 whitespace-pre-line text-[14px]">{closed.notes}</p>
              </Card>
            </li>
          ) : null}
        </ul>
      ) : working && canClose ? (
        <form action={closeDay} className="flex flex-col gap-3" data-testid="close-day-form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="branchId" value={b.id} />
          <input type="hidden" name="date" value={date} />
          {DAILY_CLOSE_SECTIONS.map((s) => {
            return (
              <Card key={s} data-testid={`section-${s}`}>
                <fieldset className="group flex flex-col gap-2">
                  <legend className="font-semibold">{t(`sections.${s}`)}</legend>
                  <p className="text-[14px] text-subtle figure">{factLine(s, facts, t, n)}</p>
                  <p className="text-[16px] font-medium">{question(s, facts, t)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Choice name={`s-${s}`} value="yes" label={t("yes")} testId={`yes-${s}`} />
                    <Choice name={`s-${s}`} value="no" label={t("no")} testId={`no-${s}`} />
                  </div>
                  {/* Shown once "Yes" is chosen; the database refuses a "Yes" without details. */}
                  <div className="hidden flex-col gap-1 group-has-[input[value=yes]:checked]:flex">
                    <label htmlFor={`n-${s}`} className="text-[13px] font-medium text-subtle">{t("details")}</label>
                    <textarea id={`n-${s}`} name={`n-${s}`} rows={2} maxLength={500} className="min-h-11 w-full rounded-button border border-outline bg-surface p-3 text-[15px]" aria-describedby={`n-${s}-hint`} />
                    <p id={`n-${s}-hint`} className="text-meta text-muted">{t("detailsHint")}</p>
                  </div>
                </fieldset>
              </Card>
            );
          })}
          <Card>
            <label htmlFor="dc-notes" className="text-[13px] font-medium text-subtle">{t("notes")}</label>
            <textarea id="dc-notes" name="notes" rows={3} maxLength={2000} className="mt-1 w-full rounded-button border border-outline bg-surface p-3 text-[15px]" />
          </Card>
          <Button type="submit" full data-testid="submit-close">{t("submit")}</Button>
        </form>
      ) : working ? (
        <ul className="flex flex-col gap-3">
          {DAILY_CLOSE_SECTIONS.map((s) => (
            <li key={s}>
              <Card>
                <h3 className="font-semibold">{t(`sections.${s}`)}</h3>
                <p className="mt-1 text-[14px] text-subtle figure">{factLine(s, facts, t, n)}</p>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      <h2 className="text-section-title font-semibold">{t("recent")}</h2>
      <Card>
        <ul className="divide-y divide-divider" data-testid="recent-days">
          {recent.map((d) => (
            <li key={d.date}>
              <Link
                href={`/daily-close?branch=${b.id}&date=${d.date}`}
                className="flex min-h-11 items-center justify-between gap-3 py-2 text-[15px]"
              >
                <span>{formatPlainDate(d.date, loc, user.digits)}</span>
                {d.closed ? (
                  <Flag tone={d.late ? "attention" : "good"}>{d.late ? t("lateClosed") : t("closed")}</Flag>
                ) : (
                  <Flag tone={d.date === today ? "neutral" : "critical"}>{t("open")}</Flag>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Choice({ name, value, label, testId }: { name: string; value: string; label: string; testId: string }) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-outline bg-surface px-4 text-[15px] has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-white">
      <input type="radio" name={name} value={value} required className="size-4 accent-brand" data-testid={testId} />
      {label}
    </label>
  );
}

/** The Yes/No question for a section: "Yes" always means something to report, with details. */
function question(s: Section, f: DayFacts, t: T): string {
  return emptySection(s, f) ? t(`questionEmpty.${s}`) : t(`question.${s}`);
}

type T = Awaited<ReturnType<typeof getTranslations<"closing.day">>>;

function factLine(s: Section, f: DayFacts, t: T, n: (v: number) => string): string {
  switch (s) {
    case "attendance": {
      const a = f.attendance;
      const line = t("facts.attendance", { present: n(a.present), absent: n(a.absent), excused: n(a.excused), done: n(a.classesDone), classes: n(a.classes) });
      return a.notMarked > 0 ? `${line} ${t("facts.notMarked", { count: a.notMarked, n: n(a.notMarked) })}` : line;
    }
    case "pickups":
      return t("facts.pickups", { out: n(f.pickups.checkedOut), still: n(f.pickups.stillIn), refusals: n(f.pickups.refusals) });
    case "staff":
      return f.staff.uploaded
        ? t("facts.staff", { present: n(f.staff.present), late: n(f.staff.late), absent: n(f.staff.absent), staff: n(f.staff.staff) })
        : t("facts.staffNoFile");
    case "payments":
      return t("facts.payments", { count: n(f.payments.count), voided: n(f.payments.voided), box: t(`facts.box.${f.payments.cashBox}`) });
    case "expenses":
      return t("facts.expenses", { count: n(f.expenses.count), waiting: n(f.expenses.waiting) });
    case "incidents":
      return t("facts.incidents", { count: n(f.incidents.count), critical: n(f.incidents.critical), open: n(f.incidents.open) });
    case "issues":
      return t("facts.issues", { new: n(f.issues.new), resolved: n(f.issues.resolved), open: n(f.issues.open), overdue: n(f.issues.overdue) });
  }
}

