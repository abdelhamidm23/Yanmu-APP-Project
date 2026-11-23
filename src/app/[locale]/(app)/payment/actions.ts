"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { redirect } from "@/i18n/navigation";
import { dbErrorCode, withUserDb } from "@/db/rls";
import { moneyError } from "@/db/money-errors";
import { recordPayment } from "@/db/billing";
import { family } from "@/db/schema";
import { canRecordPayment } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { parseEgpToPiastres } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/billing";

const locale = z.enum(["ar", "en"]).catch("ar");

/** Front desk records a payment (spec §8.4.3): family → amount → method → default allocation → numbered receipt. */
export async function recordPaymentAction(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const familyId = z.uuid().parse(fd.get("familyId"));
  const back = `/payment?branch=${fd.get("branchId")}&family=${familyId}`;
  let target = back;
  try {
    const data = z
      .object({
        amount: z.string().transform((v) => parseEgpToPiastres(v)).refine((v) => v > 0n),
        method: z.enum(PAYMENT_METHODS),
        reference: z.string().trim().max(80).transform((v) => v || null),
      })
      .parse({ amount: fd.get("amount"), method: fd.get("method"), reference: fd.get("reference") ?? "" });
    const id = await withUserDb(user.id, async (tx) => {
      const [f] = await tx.select({ branchId: family.branchId }).from(family).where(eq(family.id, familyId));
      if (!f || !canRecordPayment(user, f.branchId)) throw Object.assign(new Error("forbidden"), { code: "42501" });
      const p = await recordPayment(tx, { branchId: f.branchId, familyId, amount: data.amount, method: data.method, reference: data.reference });
      return p.id;
    });
    target = `/payments/${id}?ok=1&done=recorded`;
  } catch (e) {
    const known = moneyError(e);
    const code = known ? known.error : e instanceof ZodError || (e instanceof Error && /EGP amount/.test(e.message)) ? "invalid" : dbErrorCode(e);
    if (!known && code === "unknown") console.error("payment failed", dbErrorCode(e));
    target = `${back}&error=${code}`;
  }
  revalidatePath(`/${loc}/payment`);
  redirect({ href: target, locale: loc });
}
