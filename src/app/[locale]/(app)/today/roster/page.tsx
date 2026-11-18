import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { branchRooms, visibleBranches } from "@/db/children";
import { branchRoomsToday, branchRosterToday } from "@/db/attendance";
import { requireArea } from "@/lib/require-user";
import { canEditRoster } from "@/lib/permissions";
import { todayInCairo, cairoTimeOf } from "@/lib/calendar";
import { formatNumber, formatPlainDate } from "@/lib/format";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { ResultBanner } from "@/components/settings/ResultBanner";
import { Flag, pickBranch } from "@/components/children/BranchTabs";
import { saveRoster } from "../actions";

const select = "min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]";

/** Today's roster (spec §8.3): who is in which room, and the manager's "present" tap before the fingerprint file. */
export default async function RosterPage({
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

  const data = await withUserDb(user.id, async (tx) => {
    const b = pickBranch((await visibleBranches(tx)).filter((x) => canEditRoster(user, x.id)), sp.branch);
    if (!b) return null;
    const [rooms, people, today] = await Promise.all([branchRooms(tx, b.id), branchRosterToday(tx, b.id, date), branchRoomsToday(tx, b.id, date, { roster: true })]);
    return { b, rooms, people, today };
  });
  if (!data) notFound();
  const { b, rooms, people, today } = data;
  const roomName = (id: string | null) => {
    const r = rooms.find((x) => x.id === id);
    return r ? localName(r, locale) : t("noRoom");
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("roster")} help={`${localName(b, locale)} · ${formatPlainDate(date, loc, user.digits)} · ${t("rosterHelp")}`}>
        <Link href={`/today?branch=${b.id}`} className="text-brand underline">
          {t("backToToday")}
        </Link>
      </PageHeader>
      <ResultBanner searchParams={sp} />

      <Card className="flex flex-col gap-2" data-testid="ratio-summary">
        <h2 className="text-section-title font-semibold">{t("ratioTitle")}</h2>
        <ul className="flex flex-col gap-1 text-[14px]">
          {today
            .filter((r) => r.enrolled > 0)
            .map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {localName(r, locale)} · {t("ratioLine", { children: n(r.inNow), per: n(r.perStaff) })}
                </span>
                <Flag tone={r.ratio.state === "breach" ? "critical" : r.ratio.state === "unconfirmed" ? "attention" : "good"}>
                  {t(r.ratio.state === "breach" ? "ratioBreach" : r.ratio.state === "unconfirmed" ? "ratioUnconfirmed" : "ratioOk", {
                    carers: n(r.carersConfirmed),
                    required: n(r.ratio.required),
                  })}
                </Flag>
              </li>
            ))}
        </ul>
      </Card>

      {people.length === 0 ? <Card>{t("noStaff")}</Card> : null}
      <ul className="flex flex-col gap-2" data-testid="roster-list">
        {people.map((p) => (
          <li key={p.id} className="rounded-card border border-border bg-surface p-3" data-staff={p.fullNameEn}>
            <form action={saveRoster} className="flex flex-col gap-3">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="branchId" value={b.id} />
              <input type="hidden" name="staffId" value={p.id} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-col">
                  <span className="text-row-title font-semibold">{locale === "ar" ? p.fullNameAr : p.fullNameEn}</span>
                  <span className="text-meta text-muted">
                    {p.jobTitle}
                    {p.isQualifiedCarer ? "" : ` · ${t("notCarer")}`} · {t("usualRoom", { room: roomName(p.defaultRoomId) })}
                  </span>
                </span>
                <Flag tone={p.presence === "yes" ? "good" : p.presence === "no" ? "critical" : "neutral"}>
                  {p.presence === "yes"
                    ? p.markedPresent
                      ? t("presentTapped")
                      : t("presentFingerprint", { time: p.firstIn ? cairoTimeOf(p.firstIn) : "" })
                    : p.presence === "no"
                      ? t(p.dayStatus === "leave" ? "onLeave" : "absent")
                      : t("notConfirmed")}
                </Flag>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`room-${p.id}`} className="text-[13px] font-medium text-subtle">
                    {t("roomToday")}
                  </label>
                  <select id={`room-${p.id}`} name="roomId" defaultValue={p.roomId ?? "none"} className={select}>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {localName(r, locale)}
                      </option>
                    ))}
                    <option value="none">{t("noRoom")}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`present-${p.id}`} className="text-[13px] font-medium text-subtle">
                    {t("presentToday")}
                  </label>
                  <select id={`present-${p.id}`} name="present" defaultValue={p.markedPresent === null ? "auto" : p.markedPresent ? "yes" : "no"} className={select}>
                    <option value="auto">{t("presentAuto")}</option>
                    <option value="yes">{t("presentYes")}</option>
                    <option value="no">{t("presentNo")}</option>
                  </select>
                </div>
                <button type="submit" className={buttonClasses("secondary")} data-testid="save-roster">
                  {t("save")}
                </button>
              </div>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
