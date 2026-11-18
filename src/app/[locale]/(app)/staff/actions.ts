"use server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { appUser, staff } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { canEditStaff } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { normalizeEmployeeNo } from "@/lib/staff-import";

const locale = z.enum(["ar", "en"]).catch("ar");
const optionalDate = z.union([z.iso.date(), z.literal("")]).transform((v) => v || null);

const schema = z.object({
  fullNameAr: z.string().trim().min(2).max(120),
  fullNameEn: z.string().trim().min(2).max(120),
  jobTitle: z.string().trim().min(2).max(80),
  defaultRoomId: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
  deviceEmployeeNo: z.string().trim().max(30).transform((v) => (v ? normalizeEmployeeNo(v) : null)),
  shiftStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  startDate: optionalDate,
  endDate: optionalDate,
  email: z.string().trim().max(200),
});

/** Staff record (spec §7.2), edited by HR. A sign-in email links the record to the person's account. */
export async function saveStaff(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const id = z.union([z.uuid(), z.literal("")]).parse(fd.get("staffId") ?? "");
  const target = id ? `/staff/${id}` : `/staff/new?branch=${branchId}`;
  await runAndReturn(loc, target, async () => {
    if (!canEditStaff(user, branchId)) return { error: "forbidden" };
    const data = schema.parse(Object.fromEntries(fd.entries()));
    return withUserDb(user.id, async (tx) => {
      let userId: string | null = null;
      if (data.email) {
        const [u] = await tx.select({ id: appUser.id }).from(appUser).where(sql`lower(${appUser.email}) = lower(${data.email})`);
        if (!u) return { error: "noAccount" };
        userId = u.id;
      }
      const values = {
        fullNameAr: data.fullNameAr,
        fullNameEn: data.fullNameEn,
        jobTitle: data.jobTitle,
        isQualifiedCarer: fd.get("isQualifiedCarer") === "on",
        defaultRoomId: data.defaultRoomId,
        deviceEmployeeNo: data.deviceEmployeeNo,
        shiftStart: data.shiftStart,
        startDate: data.startDate,
        endDate: data.endDate,
        status: fd.get("left") === "on" ? "left" : "active",
        userId,
      };
      if (id) {
        const rows = await tx.update(staff).set(values).where(and(eq(staff.id, id), eq(staff.branchId, branchId))).returning({ id: staff.id });
        if (!rows.length) return { error: "notFound" };
        // Re-links this person's fingerprint punches to the (new) number.
        await tx.execute(sql`select app_set_staff_device_no(${id}, ${data.deviceEmployeeNo ?? ""})`);
      } else {
        // Saved; the form opens again empty to add the next person.
        const [row] = await tx.insert(staff).values({ ...values, branchId }).returning({ id: staff.id });
        if (data.deviceEmployeeNo) await tx.execute(sql`select app_set_staff_device_no(${row.id}, ${data.deviceEmployeeNo})`);
      }
    });
  });
}
