import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireArea } from "@/lib/require-user";
import { formatPlainDate } from "@/lib/format";
import { localName } from "@/lib/i18n-names";
import { PageHeader } from "@/components/settings/Fields";
import { RoomAttendance } from "@/components/attendance/RoomAttendance";
import { loadRoomForPhone } from "@/components/attendance/room-data";

export default async function RollCallRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; roomId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale, roomId } = await params;
  const { tab } = await searchParams;
  if (!z.uuid().safeParse(roomId).success) notFound();
  const user = await requireArea(locale, "attendance");
  const t = await getTranslations("attendance");
  const loc = locale === "en" ? "en" : "ar";
  const { date, room, children } = await loadRoomForPhone(user, roomId, locale);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${t("rollCallTitle")} · ${localName(room, locale)}`} help={`${localName({ nameAr: room.branchNameAr, nameEn: room.branchNameEn }, locale)} · ${formatPlainDate(date, loc, user.digits)}`}>
        <Link href="/roll-call" className="text-brand underline">
          {t("allRooms")}
        </Link>
      </PageHeader>
      <RoomAttendance userId={user.id} roomId={room.id} date={date} locale={locale} initialTab={tab === "pickup" ? "pickup" : "rollcall"} items={children} />
    </div>
  );
}
