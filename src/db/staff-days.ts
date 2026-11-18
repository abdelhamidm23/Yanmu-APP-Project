import "server-only";
import { and, eq, gte, isNotNull, lte, ne, sql } from "drizzle-orm";
import { room, staff, staffAttendanceDay, staffPunch } from "./schema";
import type { Tx } from "./rls";
import { addDays } from "@/lib/children";
import { cairoTimeOf, cairoWallToUtc, minutesOf, todayInCairo } from "@/lib/calendar";
import { deriveDays } from "@/lib/staff-import";
import { readOrgSettings } from "./settings";

function dayStart(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return cairoWallToUtc(y, m, d);
}

/**
 * Recomputes first in / last out / late / absent for a branch over a date range from all saved punches
 * (spec §8.3), keeping days marked as leave. Then refreshes today's ratio snapshots if today is in range.
 */
export async function rederiveStaffDays(tx: Tx, branchId: string, from: string, to: string) {
  const today = todayInCairo();
  const settings = await readOrgSettings(tx);
  const grace = Number(settings.get("staff_attendance.grace_minutes") ?? 10);
  const people = await tx
    .select({ id: staff.id, shiftStart: staff.shiftStart, status: staff.status, startDate: staff.startDate, endDate: staff.endDate })
    .from(staff)
    .where(eq(staff.branchId, branchId));
  const punches = await tx
    .select({ staffId: staffPunch.staffId, at: staffPunch.punchedAt })
    .from(staffPunch)
    .where(and(eq(staffPunch.branchId, branchId), isNotNull(staffPunch.staffId), gte(staffPunch.punchedAt, dayStart(from)), lte(staffPunch.punchedAt, dayStart(addDays(to, 1)))));
  const leaveRows = await tx
    .select({ staffId: staffAttendanceDay.staffId, date: staffAttendanceDay.date })
    .from(staffAttendanceDay)
    .where(and(eq(staffAttendanceDay.branchId, branchId), eq(staffAttendanceDay.status, "leave"), gte(staffAttendanceDay.date, from), lte(staffAttendanceDay.date, to)));
  const working = (await tx.execute(
    sql`select d::date::text as date, is_working_day(${branchId}::uuid, d::date) as working from generate_series(${from}::date, ${to}::date, interval '1 day') d`,
  )) as unknown as { date: string; working: boolean }[];
  const workingSet = new Set(working.filter((w) => w.working).map((w) => w.date));

  const days = deriveDays({
    staff: people,
    punches: punches.map((p) => ({ staffId: p.staffId!, at: p.at })),
    from,
    to,
    today,
    isWorkingDay: (d) => workingSet.has(d),
    graceMinutes: grace,
    leave: new Set(leaveRows.map((l) => `${l.staffId}|${l.date}`)),
    nowMinutes: minutesOf(cairoTimeOf(new Date())),
  });

  await tx
    .delete(staffAttendanceDay)
    .where(and(eq(staffAttendanceDay.branchId, branchId), gte(staffAttendanceDay.date, from), lte(staffAttendanceDay.date, to), ne(staffAttendanceDay.status, "leave")));
  for (let i = 0; i < days.length; i += 500) {
    const chunk = days.slice(i, i + 500).filter((d) => d.status !== "leave");
    if (chunk.length) {
      await tx
        .insert(staffAttendanceDay)
        .values(chunk.map((d) => ({ staffId: d.staffId, date: d.date, branchId, firstIn: d.firstIn, lastOut: d.lastOut, status: d.status })))
        .onConflictDoNothing();
    }
  }

  if (from <= today && today <= to) {
    const rooms = await tx.select({ id: room.id }).from(room).where(and(eq(room.branchId, branchId), eq(room.isActive, true)));
    for (const r of rooms) await tx.execute(sql`select app_take_ratio_snapshot(${r.id}, 'staff_import')`);
  }
  return days.length;
}

/** Device numbers already linked in a branch, normalized like the file's. */
export async function knownDeviceNos(tx: Tx, branchId: string) {
  const rows = await tx
    .select({ id: staff.id, no: staff.deviceEmployeeNo })
    .from(staff)
    .where(and(eq(staff.branchId, branchId), isNotNull(staff.deviceEmployeeNo)));
  return rows;
}

