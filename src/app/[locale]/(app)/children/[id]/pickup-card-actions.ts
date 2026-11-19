"use server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { pickupCard, student, studentGuardian } from "@/db/schema";
import { canEditChildren } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { hashPickupCode, newPickupCode } from "@/lib/pickup-card";

const input = z.object({ locale: z.enum(["ar", "en"]).catch("ar"), studentId: z.uuid(), guardianId: z.uuid() });

/**
 * Makes a QR pickup card for an adult who may collect this child. A card already in use is cancelled
 * first, so a lost card stops working the moment a new one is made. The code is returned once, to
 * print; only its hash is stored.
 */
export async function issuePickupCard(raw: { locale: string; studentId: string; guardianId: string }): Promise<{ code: string } | { error: string }> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: "invalid" };
  const { locale, studentId, guardianId } = parsed.data;
  const user = await requireUser(locale);
  const code = newPickupCode();
  const tokenHash = await hashPickupCode(code);
  return withUserDb(
    user.id,
    async (tx) => {
      const [s] = await tx.select({ branchId: student.branchId }).from(student).where(eq(student.id, studentId));
      if (!s || !canEditChildren(user, s.branchId)) return { error: "forbidden" };
      const [link] = await tx
        .select({ canPickUp: studentGuardian.canPickUp, branchId: studentGuardian.branchId })
        .from(studentGuardian)
        .where(and(eq(studentGuardian.studentId, studentId), eq(studentGuardian.guardianId, guardianId)));
      if (!link?.canPickUp) return { error: "not_allowed_pickup" };
      await tx.update(pickupCard).set({ revokedAt: sql`now()` }).where(and(eq(pickupCard.guardianId, guardianId), isNull(pickupCard.revokedAt)));
      await tx.insert(pickupCard).values({ guardianId, branchId: link.branchId, tokenHash });
      return { code };
    },
    { reason: "QR pickup card made" },
  );
}

/** Cancels the adult's card in use. Used when a card is lost or the adult may no longer collect. */
export async function cancelPickupCard(raw: { locale: string; studentId: string; guardianId: string }): Promise<{ ok: true } | { error: string }> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: "invalid" };
  const { locale, studentId, guardianId } = parsed.data;
  const user = await requireUser(locale);
  return withUserDb(
    user.id,
    async (tx) => {
      const [s] = await tx.select({ branchId: student.branchId }).from(student).where(eq(student.id, studentId));
      if (!s || !canEditChildren(user, s.branchId)) return { error: "forbidden" };
      await tx.update(pickupCard).set({ revokedAt: sql`now()` }).where(and(eq(pickupCard.guardianId, guardianId), isNull(pickupCard.revokedAt)));
      return { ok: true as const };
    },
    { reason: "QR pickup card cancelled" },
  );
}
