"use server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { withMoneyErrors } from "@/db/money-errors";
import { cashSession } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { canReconcileCash, canUseCashBox } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { parseEgpToPiastres } from "@/lib/format";
import { todayInCairo } from "@/lib/calendar";

const locale = z.enum(["ar", "en"]).catch("ar");
/** EGP text → piastres; empty is 0 when `optional`. */
const egp = (optional = false) =>
  z.string().transform((v, ctx) => {
    if (optional && v.trim() === "") return 0n;
    try {
      const p = parseEgpToPiastres(v);
      if (p < 0n) throw new Error();
      return p;
    } catch {
      ctx.addIssue({ code: "custom", message: "amount" });
      return z.NEVER;
    }
  });

/** Front desk opens today's cash box with the float (spec §8.5). */
export async function openCashBox(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  await runAndReturn(loc, `/cash-box?branch=${branchId}`, async () => {
    const float = egp().parse(fd.get("float") ?? "");
    if (!canUseCashBox(user, branchId)) return { error: "forbidden" };
    return withMoneyErrors(() =>
      withUserDb(user.id, async (tx) => {
        await tx.insert(cashSession).values({ branchId, date: todayInCairo(), openingFloatPiastres: float });
        return { extra: { done: "cashOpened" } };
      }),
    );
  });
}

/** Count at close and record the handover; the database works out the difference. */
export async function closeCashBox(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const sessionId = z.uuid().parse(fd.get("sessionId"));
  const branchId = z.uuid().parse(fd.get("branchId"));
  await runAndReturn(loc, `/cash-box?branch=${branchId}`, async () => {
    const data = z
      .object({ counted: egp(), handedOver: egp(true), handedTo: z.string().trim().max(120) })
      .parse({ counted: fd.get("counted") ?? "", handedOver: fd.get("handedOver") ?? "", handedTo: fd.get("handedTo") ?? "" });
    if (!canUseCashBox(user, branchId)) return { error: "forbidden" };
    return withMoneyErrors(() =>
      withUserDb(user.id, async (tx) => {
        const [s] = await tx.select({ branchId: cashSession.branchId }).from(cashSession).where(eq(cashSession.id, sessionId));
        if (!s || s.branchId !== branchId) return { error: "forbidden" };
        await tx.execute(sql`select app_close_cash_session(${sessionId}, ${data.counted}::bigint, ${data.handedOver}::bigint, ${data.handedTo})`);
        return { extra: { done: "cashClosed" } };
      }),
    );
  });
}

/** The accountant marks a closed day as checked. */
export async function reconcileCashBox(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const sessionId = z.uuid().parse(fd.get("sessionId"));
  const branchId = z.uuid().parse(fd.get("branchId"));
  await runAndReturn(loc, `/cash-box?branch=${branchId}`, async () => {
    if (!canReconcileCash(user, branchId)) return { error: "forbidden" };
    return withMoneyErrors(() =>
      withUserDb(user.id, async (tx) => {
        await tx.execute(sql`select app_reconcile_cash_session(${sessionId})`);
        return { extra: { done: "reconciled" } };
      }),
    );
  });
}
