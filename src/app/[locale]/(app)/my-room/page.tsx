import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { attendanceRooms } from "@/db/attendance";
import { requireArea } from "@/lib/require-user";
import { formatPlainDate } from "@/lib/format";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { RoomAttendance } from "@/components/attendance/RoomAttendance";
import { loadRoomForPhone } from "@/components/attendance/room-data";

/** Teacher — My room (spec §11.7): the room's children with photos and allergy flags, and check-out. */
export default async function MyRoomPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ room?: string }> }) {
  const { locale } = await params;
  const { room: requested } = await searchParams;
  const user = await requireArea(locale, "attendance");
  const t = await getTranslations("attendance");
  const loc = locale === "en" ? "en" : "ar";

  const mine = await withUserDb(user.id, async (tx) => (await attendanceRooms(tx, user)).filter((r) => r.assigned));
  if (mine.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("myRoomTitle")} />
        <Card>{t("noAssignedRoom")}</Card>
      </div>
    );
  }
  const current = mine.find((r) => r.id === requested) ?? mine[0];
  const { date, room, children } = await loadRoomForPhone(user, current.id, locale);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${t("myRoomTitle")} · ${localName(room, locale)}`} help={`${localName({ nameAr: room.branchNameAr, nameEn: room.branchNameEn }, locale)} · ${formatPlainDate(date, loc, user.digits)}`}>
        <Link href={`/roll-call/${room.id}`} className={buttonClasses("secondary")} data-testid="open-roll-call">
          {t("rollCallTitle")}
        </Link>
      </PageHeader>
      {mine.length > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label={t("pickRoom")}>
          {mine.map((r) => (
            <Link
              key={r.id}
              href={`/my-room?room=${r.id}`}
              aria-current={r.id === room.id ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-button px-4 text-[14px] font-medium ${r.id === room.id ? "bg-brand text-white" : "border border-outline bg-surface"}`}
            >
              {localName(r, locale)}
            </Link>
          ))}
        </nav>
      ) : null}
      <RoomAttendance userId={user.id} roomId={room.id} date={date} locale={locale} initialTab="pickup" items={children} />
    </div>
  );
}
