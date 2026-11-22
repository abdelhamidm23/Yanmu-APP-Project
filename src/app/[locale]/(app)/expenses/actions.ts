"use server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { redirect } from "@/i18n/navigation";
import { dbErrorCode, withUserDb, type Tx } from "@/db/rls";
import { moneyError, withMoneyErrors } from "@/db/money-errors";
import { checkUpload, hasFile, saveUpload, UploadError } from "@/db/attachments";
import { branch, expense, vendor } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { canRecordExpense } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { parseEgpToPiastres } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";

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

/** The vendor by name (any case), added the first time it is used. */
async function vendorId(tx: Tx, branchId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const [b] = await tx.select({ orgId: branch.orgId }).from(branch).where(eq(branch.id, branchId));
  const [found] = await tx
    .select({ id: vendor.id })
    .from(vendor)
    .where(and(eq(vendor.orgId, b.orgId), sql`lower(${vendor.name}) = lower(${name})`));
  if (found) return found.id;
  const [row] = await tx.insert(vendor).values({ orgId: b.orgId, name }).returning({ id: vendor.id });
  return row.id;
}

/**
 * Records an expense, or asks before spending (spec §8.6). The database decides routine or not:
 * routine ones count at once; anything else goes to approval.
 */
export async function recordExpense(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  let target = `/expenses/new?branch=${branchId}`;
  try {
    const data = z
      .object({
        categoryId: z.uuid(),
        amount: egp,
        method: z.enum(PAYMENT_METHODS),
        spentOn: z.iso.date(),
        vendor: z.string().trim().max(120).transform((v) => v || null),
        description: z.string().trim().min(2).max(500),
        flaggedNote: z.string().trim().max(500).transform((v) => v || null),
        isRequest: z.literal("on").optional().transform(Boolean),
      })
      .parse({
        categoryId: fd.get("categoryId"),
        amount: fd.get("amount") ?? "",
        method: fd.get("method"),
        spentOn: fd.get("spentOn") || todayInCairo(),
        vendor: fd.get("vendor") ?? "",
        description: fd.get("description") ?? "",
        flaggedNote: fd.get("flaggedNote") ?? "",
        isRequest: fd.get("isRequest") ?? undefined,
      });
    const photo = fd.get("receipt");
    if (hasFile(photo)) checkUpload(photo);
    if (!canRecordExpense(user, branchId)) throw Object.assign(new Error("forbidden"), { code: "42501" });
    const id = await withUserDb(user.id, async (tx) => {
      const receipt = hasFile(photo) ? await saveUpload(tx, branchId, photo) : null;
      const [row] = await tx
        .insert(expense)
        .values({
          branchId,
          categoryId: data.categoryId,
          vendorId: await vendorId(tx, branchId, data.vendor),
          spentOn: data.spentOn,
          amountPiastres: data.amount,
          paymentMethod: data.method,
          description: data.description,
          receiptAttachmentId: receipt,
          flaggedNote: data.flaggedNote,
          isRequest: data.isRequest,
        })
        .returning({ id: expense.id, status: expense.status });
      return row;
    });
    target = `/expenses/${id.id}?ok=1&done=${id.status === "recorded" ? "expenseRecorded" : data.isRequest ? "expenseAsked" : "expenseSent"}`;
  } catch (e) {
    const known = moneyError(e);
    const code = known ? known.error : e instanceof UploadError ? "bad_file" : e instanceof ZodError ? "invalid" : dbErrorCode(e);
    if (!known && code === "unknown") console.error("expense failed", dbErrorCode(e));
    target = `${target}&error=${code}`;
  }
  revalidatePath(`/${loc}/expenses`);
  redirect({ href: target, locale: loc });
}

/** The person who asked answers the approver's question; the request goes back to waiting. */
export async function answerQuestion(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const expenseId = z.uuid().parse(fd.get("expenseId"));
  const requestId = z.uuid().parse(fd.get("requestId"));
  await runAndReturn(loc, `/expenses/${expenseId}`, async () => {
    const comment = z.string().trim().min(2).max(1000).parse(fd.get("comment"));
    return withMoneyErrors(() =>
      withUserDb(user.id, async (tx) => {
        await tx.execute(sql`select app_decide_money(${requestId}, 'answer', ${comment})`);
        return { extra: { done: "answered" } };
      }),
    );
  });
}

/** A request made before spending, completed with the receipt once the money is spent. */
export async function completeRequest(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const expenseId = z.uuid().parse(fd.get("expenseId"));
  await runAndReturn(loc, `/expenses/${expenseId}`, async () => {
    const spentOn = z.iso.date().parse(fd.get("spentOn"));
    const photo = fd.get("receipt");
    if (!hasFile(photo)) return { error: "receipt_required" };
    try {
      checkUpload(photo);
    } catch {
      return { error: "bad_file" };
    }
    return withMoneyErrors(() =>
      withUserDb(user.id, async (tx) => {
        const [e] = await tx.select({ branchId: expense.branchId }).from(expense).where(eq(expense.id, expenseId));
        if (!e || !canRecordExpense(user, e.branchId)) return { error: "forbidden" };
        const receipt = await saveUpload(tx, e.branchId, photo);
        await tx.execute(sql`select app_complete_expense_request(${expenseId}, ${receipt}, ${spentOn}::date)`);
        return { extra: { done: "expenseCompleted" } };
      }),
    );
  });
}

/** Cancels a recorded expense with a reversal entry (rule 6): the original stays, marked reversed. */
export async function reverseExpense(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const expenseId = z.uuid().parse(fd.get("expenseId"));
  await runAndReturn(loc, `/expenses/${expenseId}`, async () => {
    const reason = z.string().trim().min(3).max(500).parse(fd.get("reason"));
    return withMoneyErrors(() =>
      withUserDb(
        user.id,
        async (tx) => {
          const [e] = await tx.select().from(expense).where(eq(expense.id, expenseId));
          if (!e || !canRecordExpense(user, e.branchId)) return { error: "forbidden" };
          await tx.insert(expense).values({
            branchId: e.branchId,
            categoryId: e.categoryId,
            spentOn: todayInCairo(),
            amountPiastres: -e.amountPiastres,
            paymentMethod: e.paymentMethod,
            description: reason,
            reversesExpenseId: e.id,
          });
          return { extra: { done: "expenseReversed" } };
        },
        { reason },
      ),
    );
  });
}
