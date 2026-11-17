"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { ageBand } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { requireSettings } from "@/lib/require-user";

const months = z.coerce.number().int().min(0).max(120);

export async function updateAgeBand(fd: FormData) {
  const loc = z.enum(["ar", "en"]).catch("ar").parse(fd.get("locale"));
  const user = await requireSettings(loc);
  await runAndReturn(loc, "/settings/age-bands", async () => {
    const id = z.uuid().parse(fd.get("id"));
    const data = z
      .object({
        nameAr: z.string().trim().min(1).max(60),
        nameEn: z.string().trim().min(1).max(60),
        minAgeMonths: months,
        maxAgeMonths: months,
        childrenPerStaff: z.coerce.number().int().min(1).max(30),
      })
      .refine((d) => d.maxAgeMonths > d.minAgeMonths)
      .parse(Object.fromEntries(fd.entries()));
    const rows = await withUserDb(user.id, (tx) => tx.update(ageBand).set(data).where(eq(ageBand.id, id)).returning({ id: ageBand.id }));
    if (rows.length === 0) return { error: "forbidden" };
  });
}
