"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { academicYear, calendarDay, organization, term } from "@/db/schema";
import { writeOrgSetting } from "@/db/settings";
import { runAndReturn } from "@/lib/action-result";
import { requireSettings } from "@/lib/require-user";
import { WEEKDAYS } from "@/lib/settings";

const loc = (fd: FormData) => z.enum(["ar", "en"]).catch("ar").parse(fd.get("locale"));
const PATH = "/settings/calendar";

export async function saveWorkingDays(fd: FormData) {
  const locale = loc(fd);
  const user = await requireSettings(locale);
  await runAndReturn(locale, PATH, async () => {
    const days = z.array(z.enum(WEEKDAYS)).min(1).parse(fd.getAll("days"));
    await withUserDb(user.id, (tx) => writeOrgSetting(tx, "calendar.working_days", WEEKDAYS.filter((d) => days.includes(d))));
  });
}

export async function addException(fd: FormData) {
  const locale = loc(fd);
  const user = await requireSettings(locale, "calendar");
  await runAndReturn(locale, PATH, async () => {
    const data = z
      .object({
        branchId: z.uuid(),
        date: z.iso.date(),
        kind: z.enum(["holiday", "extra"]),
        note: z.string().trim().max(120).optional(),
      })
      .parse(Object.fromEntries(fd.entries()));
    // Row-level security refuses branches this person cannot manage.
    await withUserDb(user.id, (tx) =>
      tx
        .insert(calendarDay)
        .values({ branchId: data.branchId, date: data.date, isWorkingDay: data.kind === "extra", note: data.note || null })
        .onConflictDoUpdate({
          target: [calendarDay.branchId, calendarDay.date],
          set: { isWorkingDay: data.kind === "extra", note: data.note || null },
        }),
    );
  });
}

export async function removeException(fd: FormData) {
  const locale = loc(fd);
  const user = await requireSettings(locale, "calendar");
  await runAndReturn(locale, PATH, async () => {
    const { branchId, date } = z.object({ branchId: z.uuid(), date: z.iso.date() }).parse(Object.fromEntries(fd.entries()));
    const rows = await withUserDb(user.id, (tx) =>
      tx.delete(calendarDay).where(and(eq(calendarDay.branchId, branchId), eq(calendarDay.date, date))).returning({ date: calendarDay.date }),
    );
    if (rows.length === 0) return { error: "forbidden" };
  });
}

const period = z
  .object({ label: z.string().trim().min(1).max(60), startsOn: z.iso.date(), endsOn: z.iso.date() })
  .refine((p) => p.endsOn > p.startsOn);

export async function addAcademicYear(fd: FormData) {
  const locale = loc(fd);
  const user = await requireSettings(locale);
  await runAndReturn(locale, PATH, async () => {
    const data = period.parse(Object.fromEntries(fd.entries()));
    await withUserDb(user.id, async (tx) => {
      const [org] = await tx.select({ id: organization.id }).from(organization).limit(1);
      await tx.insert(academicYear).values({ ...data, orgId: org.id });
    });
  });
}

export async function addTerm(fd: FormData) {
  const locale = loc(fd);
  const user = await requireSettings(locale);
  await runAndReturn(locale, PATH, async () => {
    const data = period.parse(Object.fromEntries(fd.entries()));
    const academicYearId = z.uuid().parse(fd.get("academicYearId"));
    await withUserDb(user.id, async (tx) => {
      const [year] = await tx.select().from(academicYear).where(eq(academicYear.id, academicYearId));
      if (!year || data.startsOn < year.startsOn || data.endsOn > year.endsOn) throw new z.ZodError([]);
      await tx.insert(term).values({ ...data, academicYearId });
    });
  });
}

export async function removeTerm(fd: FormData) {
  const locale = loc(fd);
  const user = await requireSettings(locale);
  await runAndReturn(locale, PATH, async () => {
    const id = z.uuid().parse(fd.get("id"));
    const rows = await withUserDb(user.id, (tx) => tx.delete(term).where(eq(term.id, id)).returning({ id: term.id }));
    if (rows.length === 0) return { error: "forbidden" };
  });
}
