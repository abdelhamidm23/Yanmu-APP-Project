"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { waitlistEntry } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { requireUser } from "@/lib/require-user";
import { canEditChildren } from "@/lib/permissions";
import { normalizePhone } from "@/lib/children";

const locale = z.enum(["ar", "en"]).catch("ar");

/** Spec §8.1 waitlist: by age band and requested month. */
export async function addToWaitlist(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  await runAndReturn(loc, `/children/waitlist?branch=${branchId}`, async () => {
    if (!canEditChildren(user, branchId)) return { error: "forbidden" };
    const data = z
      .object({
        studentName: z.string().trim().min(2).max(120),
        dateOfBirth: z.iso.date(),
        guardianName: z.string().trim().max(120).transform((v) => v || null),
        guardianPhone: z.string(),
        requestedMonth: z.string().regex(/^\d{4}-\d{2}$/),
        ageBandId: z.uuid(),
        notes: z.string().trim().max(500).transform((v) => v || null),
      })
      .parse(Object.fromEntries(fd.entries()));
    const phone = normalizePhone(data.guardianPhone);
    if (!phone) return { error: "badPhone" };
    await withUserDb(user.id, (tx) =>
      tx.insert(waitlistEntry).values({
        branchId,
        studentName: data.studentName,
        dateOfBirth: data.dateOfBirth,
        guardianName: data.guardianName,
        guardianPhone: phone,
        requestedStartMonth: `${data.requestedMonth}-01`,
        ageBandId: data.ageBandId,
        notes: data.notes,
      }),
    );
  });
}

export async function cancelWaitlist(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const id = z.uuid().parse(fd.get("id"));
  await runAndReturn(loc, `/children/waitlist?branch=${branchId}`, async () => {
    const rows = await withUserDb(user.id, (tx) =>
      tx.update(waitlistEntry).set({ status: "cancelled" }).where(and(eq(waitlistEntry.id, id), eq(waitlistEntry.status, "waiting"))).returning({ id: waitlistEntry.id }),
    );
    if (rows.length === 0) return { error: "forbidden" };
  });
}
