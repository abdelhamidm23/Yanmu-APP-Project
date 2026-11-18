"use server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { pickupRefusal, roomRoster, staff } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { canEditRoster } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { todayInCairo } from "@/lib/calendar";

const locale = z.enum(["ar", "en"]).catch("ar");

/**
 * Today's room and presence for one person (spec §8.3: "manager adjusts the roster on the Today screen;
 * a manual present tap is the fallback before the fingerprint upload"). Takes a ratio snapshot for the rooms touched.
 */
export async function saveRoster(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  await runAndReturn(loc, `/today/roster?branch=${branchId}`, async () => {
    const data = z
      .object({
        staffId: z.uuid(),
        roomId: z.union([z.uuid(), z.literal("none")]),
        present: z.enum(["yes", "no", "auto"]),
      })
      .parse(Object.fromEntries(fd.entries()));
    if (!canEditRoster(user, branchId)) return { error: "forbidden" };
    const date = todayInCairo();
    return withUserDb(user.id, async (tx) => {
      const [s] = await tx.select({ id: staff.id, defaultRoomId: staff.defaultRoomId }).from(staff).where(and(eq(staff.id, data.staffId), eq(staff.branchId, branchId)));
      if (!s) return { error: "notFound" };
      const [before] = await tx.select().from(roomRoster).where(and(eq(roomRoster.staffId, s.id), eq(roomRoster.date, date)));
      const roomId = data.roomId === "none" ? null : data.roomId;
      const markedPresent = data.present === "auto" ? null : data.present === "yes";
      if (roomId === s.defaultRoomId && markedPresent === null) {
        // Back to the usual room and the fingerprint decides: no roster row is needed.
        if (before) await tx.delete(roomRoster).where(and(eq(roomRoster.staffId, s.id), eq(roomRoster.date, date)));
      } else {
        await tx
          .insert(roomRoster)
          .values({ staffId: s.id, date, branchId, roomId, markedPresent })
          .onConflictDoUpdate({ target: [roomRoster.staffId, roomRoster.date], set: { roomId, markedPresent } });
      }
      const touched = new Set([before ? before.roomId : s.defaultRoomId, roomId].filter((x): x is string => Boolean(x)));
      for (const r of touched) await tx.execute(sql`select app_take_ratio_snapshot(${r}, 'roster')`);
    });
  });
}

/** The branch manager has seen a refused pickup (spec §8.2 same-day alert). */
export async function acknowledgeRefusal(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const id = z.uuid().parse(fd.get("refusalId"));
  await runAndReturn(loc, `/today?branch=${branchId}`, async () => {
    await withUserDb(user.id, async (tx) => {
      await tx
        .update(pickupRefusal)
        .set({ acknowledgedBy: user.id, acknowledgedAt: new Date() })
        .where(and(eq(pickupRefusal.id, id), isNull(pickupRefusal.acknowledgedAt)));
    });
  });
}
