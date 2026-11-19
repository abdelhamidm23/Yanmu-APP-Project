"use server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { applyAttendanceEvents } from "@/db/attendance-sync";
import { findChildByCode, pickupDetails } from "@/db/pickup";
import { canTakeAttendance } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { todayInCairo } from "@/lib/calendar";
import { readPickupInput } from "@/lib/pickup-code";

const lookupInput = z.object({ locale: z.enum(["ar", "en"]).catch("ar"), branchId: z.uuid(), input: z.string().max(200) });

export interface ScannedChild {
  id: string;
  fullNameAr: string;
  fullNameEn: string;
  photoId: string | null;
  classNameAr: string;
  classNameEn: string;
}

export type LookupResult =
  | { error: "forbidden" | "unknown" }
  | { error: "old"; child: ScannedChild }
  | ({ child: ScannedChild } & Awaited<ReturnType<typeof pickupDetails>>);

function strip<T extends ScannedChild>(c: T): ScannedChild {
  return { id: c.id, fullNameAr: c.fullNameAr, fullNameEn: c.fullNameEn, photoId: c.photoId, classNameAr: c.classNameAr, classNameEn: c.classNameEn };
}

/**
 * Reads a scanned (or typed) daily pickup code at the front desk: whose child it is, whether the
 * child is still in, and who may collect them. Nothing changes until someone taps "Hand over".
 */
export async function lookupPickup(raw: { locale: string; branchId: string; input: string }): Promise<LookupResult> {
  const parsed = lookupInput.safeParse(raw);
  if (!parsed.success) return { error: "unknown" };
  const { locale, branchId, input } = parsed.data;
  const user = await requireUser(locale);
  if (!canTakeAttendance(user, branchId)) return { error: "forbidden" };
  const code = readPickupInput(input);
  if (!code) return { error: "unknown" };
  const today = todayInCairo();
  return withUserDb(user.id, async (tx) => {
    const found = await findChildByCode(tx, branchId, code, today);
    if (!found) return { error: "unknown" as const };
    if (found.when === "old") return { error: "old" as const, child: strip(found.child) };
    return { child: strip(found.child), ...(await pickupDetails(tx, found.child.id, today)) };
  });
}

const handOverInput = lookupInput.extend({ guardianId: z.uuid() });

/**
 * Hands the child over to the adult the staff member picked, after checking the code again on the
 * server. The database still refuses anyone who is not on the child's approved list.
 */
export async function handOverByCode(raw: { locale: string; branchId: string; input: string; guardianId: string }): Promise<{ ok: true } | { error: string }> {
  const parsed = handOverInput.safeParse(raw);
  if (!parsed.success) return { error: "unknown" };
  const { locale, branchId, input, guardianId } = parsed.data;
  const user = await requireUser(locale);
  if (!canTakeAttendance(user, branchId)) return { error: "forbidden" };
  const code = readPickupInput(input);
  if (!code) return { error: "unknown" };
  const today = todayInCairo();
  return withUserDb(
    user.id,
    async (tx) => {
      const found = await findChildByCode(tx, branchId, code, today);
      if (!found) return { error: "unknown" };
      if (found.when === "old") return { error: "old" };
      const {
        results: [result],
      } = await applyAttendanceEvents(
        tx,
        [{ kind: "checkout", via: "qr", clientUuid: randomUUID(), at: new Date().toISOString(), studentId: found.child.id, date: today, guardianId }],
        { qrChecked: true },
      );
      if (result.result === "rejected") return { error: result.code };
      return result.result === "applied" ? { ok: true as const } : { error: result.result };
    },
    { reason: "Daily pickup QR scanned" },
  );
}
