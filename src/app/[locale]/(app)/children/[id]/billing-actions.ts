"use server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { student, studentService } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { canEditChildren, canEditFees } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { OPTIONAL_ITEMS } from "@/lib/billing";

const locale = z.enum(["ar", "en"]).catch("ar");

/** Switches transport or another monthly service on or off for a child (billed while on, spec §8.4.1). */
export async function setService(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const studentId = z.uuid().parse(fd.get("studentId"));
  await runAndReturn(loc, `/children/${studentId}`, async () => {
    const d = z
      .object({ itemType: z.enum(OPTIONAL_ITEMS), on: z.enum(["1", "0"]), date: z.iso.date() })
      .parse({ itemType: fd.get("itemType"), on: fd.get("on"), date: fd.get("date") });
    return withUserDb(user.id, async (tx) => {
      const [s] = await tx.select({ branchId: student.branchId }).from(student).where(eq(student.id, studentId));
      if (!s || !(canEditChildren(user, s.branchId) || canEditFees(user, s.branchId))) return { error: "forbidden" };
      const open = and(eq(studentService.studentId, studentId), eq(studentService.itemType, d.itemType), isNull(studentService.endsOn));
      const [current] = await tx.select().from(studentService).where(open);
      if (d.on === "1") {
        if (!current) await tx.insert(studentService).values({ studentId, branchId: s.branchId, itemType: d.itemType, startsOn: d.date });
      } else if (current) {
        if (d.date < current.startsOn) return { error: "invalid" };
        await tx.update(studentService).set({ endsOn: d.date }).where(eq(studentService.id, current.id));
      }
      return undefined;
    });
  });
}
