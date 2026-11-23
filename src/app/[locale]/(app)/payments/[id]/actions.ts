"use server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { withMoneyErrors } from "@/db/money-errors";
import { payment } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { canVoidPayment } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";

const locale = z.enum(["ar", "en"]).catch("ar");

/** Voids a payment (spec §8.4.3): the row stays, its allocations stop counting. Never by the person who recorded it. */
export async function voidPayment(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const paymentId = z.uuid().parse(fd.get("paymentId"));
  await runAndReturn(loc, `/payments/${paymentId}`, async () => {
    const reason = z.string().trim().min(3).max(500).parse(fd.get("reason"));
    return withMoneyErrors(() =>
      withUserDb(
        user.id,
        async (tx) => {
          const [p] = await tx.select({ branchId: payment.branchId }).from(payment).where(eq(payment.id, paymentId));
          if (!p || !canVoidPayment(user, p.branchId)) return { error: "forbidden" };
          await tx.execute(sql`select app_void_payment(${paymentId}, ${reason})`);
          return { extra: { done: "voided" } };
        },
        { reason },
      ),
    );
  });
}
