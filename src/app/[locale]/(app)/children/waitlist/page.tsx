import { and, asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { ageBand, waitlistEntry } from "@/db/schema";
import { requireChildren } from "@/lib/require-user";
import { canEditChildren } from "@/lib/permissions";
import { ageInMonths } from "@/lib/children";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber } from "@/lib/format";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { BranchTabs, pickBranch } from "@/components/children/BranchTabs";
import { ChildResult } from "@/components/children/ChildResult";
import { addToWaitlist, cancelWaitlist } from "./actions";

function monthLabel(isoDate: string, locale: "ar" | "en", digits: "arabic" | "latin") {
  const [y, m] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(`${locale === "ar" ? "ar-EG" : "en-EG"}-u-nu-${digits === "arabic" ? "arab" : "latn"}`, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export default async function WaitlistPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireChildren(locale, "waitlist");
  const t = await getTranslations("children");
  const loc = locale === "en" ? "en" : "ar";
  const n = (v: number) => formatNumber(v, loc, user.digits);
  const today = todayInCairo();

  const data = await withUserDb(user.id, async (tx) => {
    const branches = await visibleBranches(tx);
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const entries = await tx
      .select({ w: waitlistEntry, band: ageBand })
      .from(waitlistEntry)
      .leftJoin(ageBand, eq(ageBand.id, waitlistEntry.ageBandId))
      .where(and(eq(waitlistEntry.branchId, b.id), eq(waitlistEntry.status, "waiting")))
      .orderBy(asc(ageBand.sort), asc(waitlistEntry.requestedStartMonth), asc(waitlistEntry.createdAt));
    const bands = await tx.select().from(ageBand).orderBy(asc(ageBand.sort));
    return { branches, b, entries, bands };
  });
  if (!data) return <Card>{t("noBranch")}</Card>;
  const { branches, b, entries, bands } = data;
  const canEdit = canEditChildren(user, b.id);
  const byBand = bands.map((band) => ({ band, count: entries.filter((e) => e.band?.id === band.id).length })).filter((x) => x.count > 0);

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/children?branch=${b.id}`} className="text-[14px] text-brand underline">{t("backToList")}</Link>
      <PageHeader title={t("waitlistPage.title")} help={t("waitlistPage.help")}>
        <a href={`/api/export/waitlist?branch=${b.id}&locale=${loc}`} className={buttonClasses("secondary")}>{t("export")}</a>
      </PageHeader>
      <BranchTabs branches={branches} current={b.id} path="/children/waitlist" locale={locale} label={t("branch")} />
      <ChildResult searchParams={sp} />
      <Card data-testid="waitlist-summary">
        <p className="figure text-section-title font-semibold">{t("waitlistPage.summary", { count: entries.length, n: n(entries.length) })}</p>
        {byBand.length ? (
          <p className="figure text-meta text-muted">{byBand.map((x) => `${localName(x.band, locale)} ${n(x.count)}`).join(" · ")}</p>
        ) : null}
      </Card>

      {entries.length === 0 ? (
        <Card><p className="text-muted">{t("waitlistPage.empty")}</p></Card>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="waitlist">
          {entries.map(({ w, band }) => {
            const m = ageInMonths(w.dateOfBirth, today);
            return (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="flex flex-col">
                  <span className="font-semibold">{w.studentName}</span>
                  <span className="figure text-meta text-subtle">
                    {t("age", { years: n(Math.floor(m / 12)), months: n(m % 12) })}
                    {band ? ` · ${localName(band, locale)}` : ""} · {t("waitlistPage.from", { month: monthLabel(w.requestedStartMonth, loc, user.digits) })}
                  </span>
                  <span className="figure text-meta text-muted" dir="auto">{[w.guardianName, w.guardianPhone].filter(Boolean).join(" · ")}</span>
                  {w.notes ? <span className="text-meta text-muted">{w.notes}</span> : null}
                </span>
                {canEdit ? (
                  <span className="flex items-center gap-2">
                    <Link href={`/children/new?branch=${b.id}&waitlist=${w.id}`} className={buttonClasses("primary")} data-testid="waitlist-enroll">{t("waitlistPage.convert")}</Link>
                    <form action={cancelWaitlist}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="branchId" value={b.id} />
                      <input type="hidden" name="id" value={w.id} />
                      <Button type="submit" variant="secondary">{t("waitlistPage.cancel")}</Button>
                    </form>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit ? (
        <Card>
          <h2 className="text-section-title font-semibold">{t("waitlistPage.add")}</h2>
          <form action={addToWaitlist} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="waitlist-form">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="branchId" value={b.id} />
            <Field id="wl-name" name="studentName" label={t("waitlistPage.childName")} required />
            <Field id="wl-dob" name="dateOfBirth" type="date" label={t("dob")} max={today} required />
            <Field id="wl-gname" name="guardianName" label={t("waitlistPage.guardianName")} />
            <Field id="wl-phone" name="guardianPhone" type="tel" dir="ltr" label={t("form.phone")} hint={t("form.phoneHint")} required />
            <Field id="wl-month" name="requestedMonth" type="month" label={t("waitlistPage.month")} defaultValue={today.slice(0, 7)} required />
            <SelectField id="wl-band" name="ageBandId" label={t("waitlistPage.band")} options={bands.map((x) => ({ value: x.id, label: localName(x, locale) }))} />
            <Field id="wl-notes" name="notes" label={t("detail.note")} />
            <div className="flex items-end"><Button type="submit">{t("waitlistPage.addButton")}</Button></div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
