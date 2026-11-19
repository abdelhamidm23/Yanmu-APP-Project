"use server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { pickupCard, student, studentGuardian } from "@/db/schema";
import { canEditChildren } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { hashPickupLinkSecret, newPickupLinkSecret } from "@/lib/pickup-card";

const input = z.object({ locale: z.enum(["ar", "en"]).catch("ar"), studentId: z.uuid(), guardianId: z.uuid() });

/**
 * Makes a private pickup link for an adult who may collect this child. The page behind it shows
 * today's pickup QR for every child this adult may collect, and a new one each day. A link already in
 * use is cancelled first, so a lost or shared link stops working the moment a new one is made.
 * The link is returned once, to give to the adult; only the hash of its secret is stored.
 */
export async function issuePickupLink(raw: { locale: string; studentId: string; guardianId: string }): Promise<{ secret: string } | { error: string }> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: "invalid" };
  const { locale, studentId, guardianId } = parsed.data;
  const user = await requireUser(locale);
  const secret = newPickupLinkSecret();
  const tokenHash = hashPickupLinkSecret(secret);
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
      return { secret };
    },
    { reason: "Pickup link made" },
  );
}

/** Cancels the adult's link in use, when a phone is lost or the adult may no longer collect. */
export async function cancelPickupLink(raw: { locale: string; studentId: string; guardianId: string }): Promise<{ ok: true } | { error: string }> {
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
    { reason: "Pickup link cancelled" },
  );
}

/**
 * Gives the child a new pickup code for the rest of today, when a screenshot of today's code went to
 * someone it should not have. Links show the new code at once; the old one stops working.
 */
export async function newPickupCodeToday(raw: { locale: string; studentId: string }): Promise<{ ok: true } | { error: string }> {
  const parsed = input.pick({ locale: true, studentId: true }).safeParse(raw);
  if (!parsed.success) return { error: "invalid" };
  const { locale, studentId } = parsed.data;
  const user = await requireUser(locale);
  return withUserDb(
    user.id,
    async (tx) => {
      const [s] = await tx.select({ branchId: student.branchId }).from(student).where(eq(student.id, studentId));
      if (!s || !canEditChildren(user, s.branchId)) return { error: "forbidden" };
      await tx
        .update(student)
        .set({ pickupCodeVersion: sql`${student.pickupCodeVersion} + 1` })
        .where(eq(student.id, studentId));
      return { ok: true as const };
    },
    { reason: "New pickup code for today" },
  );
}
