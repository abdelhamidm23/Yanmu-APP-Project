"use server";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { postInvoiceRun } from "@/db/billing";
import { runAndReturn } from "@/lib/action-result";
import { canRunInvoices } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { todayInCairo } from "@/lib/calendar";
import { monthStart } from "@/lib/billing";

const locale = z.enum(["ar", "en"]).catch("ar");

/** Posts the month's invoice run (spec §8.4.1): one invoice per child not yet invoiced. */
export async function postRun(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const month = monthStart(z.string().regex(/^\d{4}-\d{2}-01$/).parse(fd.get("month")));
  await runAndReturn(loc, `/invoices/run?branch=${branchId}&month=${month}`, async () => {
    if (!canRunInvoices(user, branchId)) return { error: "forbidden" };
    const today = todayInCairo();
    const created = await withUserDb(user.id, (tx) => postInvoiceRun(tx, branchId, month, today > month ? today : month), { reason: "invoice run" });
    return { extra: { created: String(created) } };
  });
}
