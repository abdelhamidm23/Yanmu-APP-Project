"use server";
import { and, eq, gt, gte, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { ageBand, discountRule, feeList, feeListItem } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { canEditFees } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { parseEgpToPiastres } from "@/lib/format";
import { monthStart } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";

const locale = z.enum(["ar", "en"]).catch("ar");

/** "" → null (no fee: missing, never zero, rule 1); otherwise EGP → piastres. */
function amountOrNull(v: FormDataEntryValue | null): bigint | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const p = parseEgpToPiastres(s);
  if (p < 0n) throw new z.ZodError([]);
  return p;
}

const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * Saves the branch's prices from a date (spec §8.4.1: fee lists with effective dates). The list in force
 * before that date ends the day before, so past invoices keep their prices. Saving again for the same
 * start date replaces that list's prices.
 */
export async function saveFeeList(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  await runAndReturn(loc, `/settings/fees?branch=${branchId}`, async () => {
    if (!canEditFees(user, branchId)) return { error: "forbidden" };
    const from = z.iso.date().parse(fd.get("effectiveFrom"));
    if (from < monthStart(todayInCairo())) return { error: "past_date" };
    const name = z.string().trim().min(1).max(80).parse(fd.get("name") || from);
    let parsed: { ageBandId: string | null; itemType: string; amount: bigint }[];
    try {
      parsed = [];
      for (const [k, v] of fd.entries()) {
        const m = /^fee:(tuition|registration|transport|service):(all|[0-9a-f-]{36})$/.exec(k);
        if (!m) continue;
        const amount = amountOrNull(v);
        if (amount !== null) parsed.push({ itemType: m[1], ageBandId: m[2] === "all" ? null : m[2], amount });
      }
    } catch {
      return { error: "invalid" };
    }
    if (!parsed.some((p) => p.itemType === "tuition")) return { error: "no_tuition" };
    return withUserDb(user.id, async (tx) => {
      const bands = new Set((await tx.select({ id: ageBand.id }).from(ageBand)).map((b) => b.id));
      const items = parsed.filter((p) => p.ageBandId === null || bands.has(p.ageBandId));
      const [later] = await tx.select({ id: feeList.id }).from(feeList).where(and(eq(feeList.branchId, branchId), gt(feeList.effectiveFrom, from)));
      if (later) return { error: "later_list" };
      const [same] = await tx.select().from(feeList).where(and(eq(feeList.branchId, branchId), eq(feeList.effectiveFrom, from), eq(feeList.isDemo, false)));
      let listId: string;
      if (same) {
        await tx.update(feeList).set({ name }).where(eq(feeList.id, same.id));
        await tx.delete(feeListItem).where(eq(feeListItem.feeListId, same.id));
        listId = same.id;
      } else {
        await tx
          .update(feeList)
          .set({ effectiveTo: dayBefore(from) })
          .where(and(eq(feeList.branchId, branchId), lt(feeList.effectiveFrom, from), or(isNull(feeList.effectiveTo), gte(feeList.effectiveTo, from))));
        const [row] = await tx.insert(feeList).values({ branchId, name, effectiveFrom: from }).returning({ id: feeList.id });
        listId = row.id;
      }
      await tx.insert(feeListItem).values(items.map((i) => ({ feeListId: listId, branchId, ageBandId: i.ageBandId, itemType: i.itemType, monthlyAmountPiastres: i.amount })));
      return { extra: { done: "feesSaved" } };
    });
  });
}

/** Adds a discount or offer (D6: none active at launch). */
export async function addDiscount(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  await runAndReturn(loc, `/settings/fees?branch=${branchId}`, async () => {
    if (!canEditFees(user, branchId)) return { error: "forbidden" };
    const d = z
      .object({
        name: z.string().trim().min(2).max(80),
        type: z.enum(["percent", "amount"]),
        value: z.string().trim().min(1),
        appliesTo: z.enum(["tuition", "registration", "transport", "service"]),
        startsOn: z.iso.date(),
        endsOn: z.union([z.literal(""), z.iso.date()]).transform((v) => v || null),
      })
      .parse(Object.fromEntries(fd.entries()));
    // Percent is kept in basis points (12.5% = 1250); an amount in piastres.
    const value = d.type === "percent" ? BigInt(Math.round(Number(d.value) * 100)) : parseEgpToPiastres(d.value);
    if (value <= 0n || (d.type === "percent" && value > 10000n)) return { error: "invalid" };
    await withUserDb(user.id, (tx) =>
      tx.insert(discountRule).values({ branchId, name: d.name, type: d.type, value, appliesTo: d.appliesTo, startsOn: d.startsOn, endsOn: d.endsOn, isActive: true }),
    );
    return { extra: { done: "discountAdded" } };
  });
}

/** Stops a discount from today; invoices already issued keep it. */
export async function stopDiscount(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const id = z.uuid().parse(fd.get("id"));
  await runAndReturn(loc, `/settings/fees?branch=${branchId}`, async () => {
    if (!canEditFees(user, branchId)) return { error: "forbidden" };
    const today = todayInCairo();
    await withUserDb(user.id, (tx) =>
      tx
        .update(discountRule)
        .set({ isActive: false, endsOn: sql`least(coalesce(${discountRule.endsOn}, ${today}::date), ${today}::date)` })
        .where(and(eq(discountRule.id, id), eq(discountRule.branchId, branchId))),
    );
    return { extra: { done: "discountStopped" } };
  });
}

