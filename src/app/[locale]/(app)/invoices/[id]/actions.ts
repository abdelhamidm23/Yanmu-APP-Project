"use server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { withMoneyErrors } from "@/db/money-errors";
import { creditNote, invoice } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { canRecordPayment, canRequestCredit } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { parseEgpToPiastres } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/billing";

const locale = z.enum(["ar", "en"]).catch("ar");
const egp = z.string().transform((v, ctx) => {
  try {
    const p = parseEgpToPiastres(v);
    if (p <= 0n) throw new Error();
    return p;
  } catch {
    ctx.addIssue({ code: "custom", message: "amount" });
    return z.NEVER;
  }
});

/** Correction, refund or late-fee waiver (spec §8.4.5): saved as a credit note waiting for approval. */
export async function requestCredit(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const invoiceId = z.uuid().parse(fd.get("invoiceId"));
  await runAndReturn(loc, `/invoices/${invoiceId}`, async () => {
    const data = z
      .object({ kind: z.enum(["correction", "refund", "waiver"]), amount: egp, reason: z.string().trim().min(3).max(500) })
      .parse(Object.fromEntries(fd.entries()));
    return withMoneyErrors(() =>
      withUserDb(user.id, async (tx) => {
        const [inv] = await tx.select({ branchId: invoice.branchId }).from(invoice).where(eq(invoice.id, invoiceId));
        if (!inv || !canRequestCredit(user, inv.branchId)) return { error: "forbidden" };
        await tx.insert(creditNote).values({ invoiceId, branchId: inv.branchId, kind: data.kind, amountPiastres: data.amount, reason: data.reason });
        return { extra: { done: "creditRequested" } };
      }, { reason: data.reason }),
    );
  });
}

/** Pays an approved refund back to the family (cash comes out of today's cash box). */
export async function payRefund(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const invoiceId = z.uuid().parse(fd.get("invoiceId"));
  const creditNoteId = z.uuid().parse(fd.get("creditNoteId"));
  const method = z.enum(PAYMENT_METHODS).parse(fd.get("method"));
  await runAndReturn(loc, `/invoices/${invoiceId}`, async () => {
    return withMoneyErrors(() =>
      withUserDb(user.id, async (tx) => {
        const [cn] = await tx.select({ branchId: creditNote.branchId }).from(creditNote).where(eq(creditNote.id, creditNoteId));
        if (!cn || !canRecordPayment(user, cn.branchId)) return { error: "forbidden" };
        await tx.execute(sql`select app_pay_refund(${creditNoteId}, ${method})`);
        return { extra: { done: "refundPaid" } };
      }),
    );
  });
}
