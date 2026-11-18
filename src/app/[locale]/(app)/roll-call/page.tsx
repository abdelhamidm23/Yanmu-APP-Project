import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { attendanceRooms } from "@/db/attendance";
import { studentAttendance, enrollment } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireArea } from "@/lib/require-user";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber } from "@/lib/format";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/settings/Fields";

/** Room picker for roll call (spec §8.2). A teacher with one room goes straight to it. */
export default async function RollCallPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireArea(locale, "attendance");
  const t = await getTranslations("attendance");
  const loc = locale === "en" ? "en" : "ar";
  const n = (v: number) => formatNumber(v, loc, user.digits);
  const date = todayInCairo();

  const rooms = await withUserDb(user.id, async (tx) => {
    const list = await attendanceRooms(tx, user);
    if (!list.length) return [];
    const counts = await tx
      .select({
        roomId: enrollment.roomId,
        enrolled: sql<number>`count(*)::int`,
        marked: sql<number>`count(${studentAttendance.id})::int`,
        present: sql<number>`count(*) filter (where ${studentAttendance.status} = 'present')::int`,
      })
      .from(enrollment)
      .leftJoin(studentAttendance, and(eq(studentAttendance.studentId, enrollment.studentId), eq(studentAttendance.date, date)))
      .where(and(eq(enrollment.status, "active"), inArray(enrollment.roomId, list.map((r) => r.id))))
      .groupBy(enrollment.roomId);
    const by = new Map(counts.map((c) => [c.roomId, c]));
    return list.map((r) => ({ ...r, enrolled: by.get(r.id)?.enrolled ?? 0, marked: by.get(r.id)?.marked ?? 0, present: by.get(r.id)?.present ?? 0 }));
  });

  const onlyAssigned = rooms.filter((r) => r.assigned);
  if (rooms.length === 1) redirect({ href: `/roll-call/${rooms[0].id}`, locale });
  if (!user.grants.some((g) => g.role === "branch_manager" || g.role === "front_desk") && onlyAssigned.length === 1) {
    redirect({ href: `/roll-call/${onlyAssigned[0].id}`, locale });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("rollCallTitle")} help={t("pickRoom")} />
      {rooms.length === 0 ? <Card>{t("noRooms")}</Card> : null}
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="room-list">
        {rooms.map((r) => (
          <li key={r.id}>
            <Link href={`/roll-call/${r.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-bg">
              <span className="flex flex-col">
                <span className="text-row-title font-semibold">{localName(r, locale)}</span>
                <span className="text-meta text-muted">{localName({ nameAr: r.branchNameAr, nameEn: r.branchNameEn }, locale)}</span>
              </span>
              <span className={`figure text-meta ${r.marked === r.enrolled && r.enrolled > 0 ? "text-verified-fg" : "text-attention"}`}>
                {r.enrolled === 0
                  ? t("emptyRoom")
                  : r.marked === r.enrolled
                    ? t("rollDone", { present: n(r.present), enrolled: n(r.enrolled) })
                    : t("rollPartial", { marked: n(r.marked), enrolled: n(r.enrolled) })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
