import "server-only";
import { notFound } from "next/navigation";
import { withUserDb } from "@/db/rls";
import { attendanceRooms, roomDay } from "@/db/attendance";
import { todayInCairo } from "@/lib/calendar";
import type { CurrentUser } from "@/lib/session";
import type { AttendanceChild } from "./RoomAttendance";

/** Loads one room for the class-phone screens, or 404 if this person does not look after it. */
export async function loadRoomForPhone(user: CurrentUser, roomId: string, locale: string) {
  const date = todayInCairo();
  const data = await withUserDb(user.id, async (tx) => {
    const rooms = await attendanceRooms(tx, user);
    const r = rooms.find((x) => x.id === roomId);
    if (!r) return null;
    const day = await roomDay(tx, roomId, date, { medical: true });
    return day ? { room: r, day } : null;
  });
  if (!data) notFound();
  const children: AttendanceChild[] = data.day.children.map((c) => ({
    id: c.id,
    name: locale === "ar" ? c.fullNameAr : c.fullNameEn,
    photoId: c.photoId,
    day: c.day,
    pickup: c.pickup,
    hasMedical: Boolean(c.medical),
    medical: c.medical,
  }));
  return { date, room: data.room, children };
}
