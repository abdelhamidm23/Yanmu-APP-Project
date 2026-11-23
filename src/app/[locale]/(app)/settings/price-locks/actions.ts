"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { priceLock, student } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { canEditFees } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { parseEgpToPiastres } from "@/lib/format";
import { ITEM_TYPES } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";

const locale = z.enum(["ar", "en"]).catch("ar");

/** A child keeps an older price (spec §8.4.2, D7). The owner or company manager saving it is the approval. */
export async function addPriceLock(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const back = z.string().regex(/^\/[a-z0-9/?=&-]*$/i).catch(`/settings/price-locks?branch=${branchId}`).parse(fd.get("back"));
  await runAndReturn(loc, back, async () => {
    if (!canEditFees(user, branchId)) return { error: "forbidden" };
    const d = z
      .object({
        studentId: z.uuid(),
        itemType: z.enum(ITEM_TYPES),
        amount: z.string().trim().min(1),
        reason: z.string().trim().min(3).max(300),
        startsOn: z.iso.date(),
        endsOn: z.union([z.literal(""), z.iso.date()]).transform((v) => v || null),
      })
      .parse(Object.fromEntries(fd.entries()));
    let amount: bigint;
    try {
      amount = parseEgpToPiastres(d.amount);
    } catch {
      return { error: "invalid" };
    }
    return withUserDb(
      user.id,
      async (tx) => {
        const [s] = await tx.select({ id: student.id }).from(student).where(and(eq(student.id, d.studentId), eq(student.branchId, branchId)));
        if (!s) return { error: "forbidden" };
        await tx.insert(priceLock).values({ branchId, studentId: s.id, itemType: d.itemType, amountPiastres: amount, reason: d.reason, startsOn: d.startsOn, endsOn: d.endsOn });
        return { extra: { done: "lockSaved" } };
      },
      { reason: d.reason },
    );
  });
}

/** Ends a legacy price; from the next invoice the child pays the fee list. */
export async function endPriceLock(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const id = z.uuid().parse(fd.get("id"));
  const back = z.string().regex(/^\/[a-z0-9/?=&-]*$/i).catch(`/settings/price-locks?branch=${branchId}`).parse(fd.get("back"));
  await runAndReturn(loc, back, async () => {
    if (!canEditFees(user, branchId)) return { error: "forbidden" };
    const endsOn = z.iso.date().catch(todayInCairo()).parse(fd.get("endsOn"));
    await withUserDb(user.id, (tx) => tx.update(priceLock).set({ endsOn }).where(and(eq(priceLock.id, id), eq(priceLock.branchId, branchId))));
    return { extra: { done: "lockEnded" } };
  });
}
