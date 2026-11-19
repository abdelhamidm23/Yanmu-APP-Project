import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { pickupCard, pickupRefusal, studentAttendance } from "./schema";
import { dbErrorCode, dbRuleCode, type Tx } from "./rls";
import { addDays } from "@/lib/children";
import { todayInCairo } from "@/lib/calendar";
import { EMPTY_DAY, applyEvent, type AttendanceEvent, type DayRecord, type EventResult } from "@/lib/attendance";

/** Offline taps may arrive late, but only for today and the two days before (Cairo). */
export function eventDateAllowed(date: string, today = todayInCairo()): boolean {
  return date <= today && date >= addDays(today, -2);
}

/**
 * Applies taps from a class phone, each in its own savepoint so one refusal does not undo the rest
 * (spec §8.2 offline queue). Row-level security and the database triggers make the final decisions:
 * a teacher outside the room, or a check-out to someone not on the list, is rejected there too.
 */
export async function applyAttendanceEvents(tx: Tx, events: AttendanceEvent[]) {
  const results: EventResult[] = [];
  const days = new Map<string, DayRecord>();
  const rooms = new Set<string>();

  for (const ev of events) {
    if (!eventDateAllowed(ev.date)) {
      results.push({ clientUuid: ev.clientUuid, result: "rejected", code: "bad_date" });
      continue;
    }
    try {
      const outcome = await tx.transaction(async (sp) => {
        if (ev.kind === "refusal") {
          const inserted = await sp
            .insert(pickupRefusal)
            .values({ studentId: ev.studentId, branchId: sql`null`, personName: ev.personName || null, note: ev.note || null, happenedAt: new Date(ev.at), clientUuid: ev.clientUuid })
            .onConflictDoNothing({ target: pickupRefusal.clientUuid })
            .returning({ id: pickupRefusal.id });
          return { result: inserted.length ? ("applied" as const) : ("duplicate" as const) };
        }

        const [row] = await sp
          .select()
          .from(studentAttendance)
          .where(and(eq(studentAttendance.studentId, ev.studentId), eq(studentAttendance.date, ev.date)))
          .for("update");
        if (row?.clientUuid === ev.clientUuid) return { result: "duplicate" as const };
        const before: DayRecord = row
          ? {
              status: row.status as DayRecord["status"],
              checkInAt: row.checkInAt?.toISOString() ?? null,
              checkOutAt: row.checkOutAt?.toISOString() ?? null,
              collectedByGuardianId: row.collectedByGuardianId,
              checkOutVia: (row.checkOutMethod as DayRecord["checkOutVia"]) ?? null,
              clientAt: row.clientAt?.toISOString() ?? null,
            }
          : EMPTY_DAY;
        // A QR check-out needs the adult's card to be still in use (a phone may hold an old list).
        if (ev.kind === "checkout" && ev.via === "qr") {
          const [card] = await sp
            .select({ id: pickupCard.id })
            .from(pickupCard)
            .where(and(eq(pickupCard.guardianId, ev.guardianId), isNull(pickupCard.revokedAt)));
          if (!card) return { result: "rejected" as const, code: "card_cancelled" };
        }
        const next = applyEvent(before, ev);
        if ("error" in next) return { result: "rejected" as const, code: next.error };
        if (next.result === "stale") return { result: "stale" as const };

        const values = {
          status: next.day.status!,
          excuseReason: ev.kind === "mark" && ev.status === "excused" ? ev.reason || null : null,
          checkInAt: next.day.checkInAt ? new Date(next.day.checkInAt) : null,
          checkOutAt: next.day.checkOutAt ? new Date(next.day.checkOutAt) : null,
          collectedByGuardianId: next.day.collectedByGuardianId,
          checkOutMethod: next.day.checkOutAt ? (next.day.checkOutVia ?? "list") : null,
          clientUuid: ev.clientUuid,
          clientAt: new Date(ev.at),
        };
        const [saved] = row
          ? await sp.update(studentAttendance).set(values).where(eq(studentAttendance.id, row.id)).returning({ roomId: studentAttendance.roomId })
          : await sp
              .insert(studentAttendance)
              // branch and room come from the child's active enrollment (database trigger).
              .values({ ...values, studentId: ev.studentId, date: ev.date, branchId: sql`null`, roomId: sql`null` })
              .returning({ roomId: studentAttendance.roomId });
        if (ev.date === todayInCairo()) rooms.add(saved.roomId);
        days.set(ev.studentId, next.day);
        return { result: "applied" as const };
      });
      results.push(outcome.result === "rejected" ? { clientUuid: ev.clientUuid, result: "rejected", code: outcome.code! } : { clientUuid: ev.clientUuid, result: outcome.result });
    } catch (e) {
      results.push({ clientUuid: ev.clientUuid, result: "rejected", code: dbRuleCode(e) ?? dbErrorCode(e) });
    }
  }

  // Spec §8.3: a ratio snapshot whenever roll call changes.
  for (const roomId of rooms) {
    try {
      await tx.transaction((sp) => sp.execute(sql`select app_take_ratio_snapshot(${roomId}, 'roll_call')`));
    } catch {
      // A snapshot that cannot be taken never blocks the roll call itself.
    }
  }
  return { results, days: Object.fromEntries(days) };
}
