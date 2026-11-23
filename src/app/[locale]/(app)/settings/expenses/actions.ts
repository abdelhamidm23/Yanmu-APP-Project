"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { branchRoutineCategory, expenseCategory } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { canEditFees } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";

const locale = z.enum(["ar", "en"]).catch("ar");

/** The categories a branch manager may spend on without asking (spec §8.6, A2), per branch. */
export async function saveRoutine(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  await runAndReturn(loc, `/settings/expenses?branch=${branchId}`, async () => {
    if (!canEditFees(user, branchId)) return { error: "forbidden" };
    const chosen = new Set(fd.getAll("routine").map((v) => z.uuid().parse(v)));
    await withUserDb(user.id, async (tx) => {
      const all = await tx.select({ id: expenseCategory.id }).from(expenseCategory);
      const now = new Set(
        (await tx.select({ id: branchRoutineCategory.categoryId }).from(branchRoutineCategory).where(eq(branchRoutineCategory.branchId, branchId))).map((r) => r.id),
      );
      for (const c of all) {
        if (chosen.has(c.id) && !now.has(c.id)) await tx.insert(branchRoutineCategory).values({ branchId, categoryId: c.id });
        if (!chosen.has(c.id) && now.has(c.id)) {
          await tx
            .delete(branchRoutineCategory)
            .where(and(eq(branchRoutineCategory.branchId, branchId), eq(branchRoutineCategory.categoryId, c.id)));
        }
      }
    });
    return { extra: { done: "saved" } };
  });
}

