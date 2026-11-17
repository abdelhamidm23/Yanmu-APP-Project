"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { branch, organization, room } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { requireSettings } from "@/lib/require-user";

const locale = z.enum(["ar", "en"]).catch("ar");
const text = z.string().trim().min(1).max(120);
const optionalText = z.string().trim().max(120).transform((v) => v || null);
const optionalDate = z.string().trim().transform((v) => v || null).pipe(z.iso.date().nullable());
const count = z.coerce.number().int().min(1).max(10000);

const branchFields = z.object({
  nameAr: text,
  nameEn: text,
  code: z.string().trim().min(1).max(12),
  licensedCapacity: count,
  physicalCapacity: count,
  licenceNo: optionalText,
  licenceExpiry: optionalDate,
});

function fields(fd: FormData) {
  return Object.fromEntries(fd.entries());
}

export async function createBranch(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireSettings(loc);
  await runAndReturn(loc, "/settings/branches", async () => {
    const data = branchFields.parse(fields(fd));
    await withUserDb(user.id, async (tx) => {
      const [org] = await tx.select({ id: organization.id }).from(organization).limit(1);
      await tx.insert(branch).values({ ...data, orgId: org.id });
    });
  });
}

export async function updateBranch(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireSettings(loc);
  const id = z.uuid().parse(fd.get("id"));
  await runAndReturn(loc, `/settings/branches/${id}`, async () => {
    const data = branchFields.extend({ isActive: z.coerce.boolean() }).parse({ ...fields(fd), isActive: fd.get("isActive") === "on" });
    const rows = await withUserDb(user.id, (tx) => tx.update(branch).set(data).where(eq(branch.id, id)).returning({ id: branch.id }));
    if (rows.length === 0) return { error: "forbidden" };
  });
}

const roomFields = z.object({
  nameAr: text,
  nameEn: text,
  ageBandId: z.uuid(),
  capacity: z.coerce.number().int().min(1).max(500),
});

export async function createRoom(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireSettings(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  await runAndReturn(loc, `/settings/branches/${branchId}`, async () => {
    const data = roomFields.parse(fields(fd));
    await withUserDb(user.id, (tx) => tx.insert(room).values({ ...data, branchId }));
  });
}

export async function updateRoom(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireSettings(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const id = z.uuid().parse(fd.get("id"));
  await runAndReturn(loc, `/settings/branches/${branchId}`, async () => {
    const data = roomFields.parse(fields(fd));
    const rows = await withUserDb(user.id, (tx) =>
      tx.update(room).set({ ...data, isActive: fd.get("isActive") === "on" }).where(eq(room.id, id)).returning({ id: room.id }),
    );
    if (rows.length === 0) return { error: "forbidden" };
  });
}
