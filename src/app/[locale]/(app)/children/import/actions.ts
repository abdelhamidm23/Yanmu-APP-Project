"use server";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUserDb, dbErrorCode, dbRuleCode, type Tx } from "@/db/rls";
import { activeCount, branchRooms } from "@/db/children";
import { branch, consentRecord, enrollment, family, guardian, importBatch, student, studentGuardian } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { getCurrentUser } from "@/lib/session";
import { requireUser } from "@/lib/require-user";
import { hasRoleIn } from "@/lib/permissions";
import { checkImportRows, columnForHeader, type ImportError, type RawRow } from "@/lib/child-import";
import { readSheet } from "@/lib/excel";
import { todayInCairo } from "@/lib/calendar";

export type ImportState =
  | { status: "idle" }
  | { status: "error"; code: string }
  | { status: "preview"; fileName: string; rowsJson: string; count: number; errors: ImportError[]; sample: { row: number; name: string; room: string; bandOverride: boolean }[] }
  | { status: "done"; count: number };

const MAX_FILE = 5 * 1024 * 1024;

async function context(tx: Tx, branchId: string) {
  const rooms = await branchRooms(tx, branchId);
  const [b] = await tx.select({ licensed: branch.licensedCapacity }).from(branch).where(eq(branch.id, branchId));
  const existing = await tx.select({ fullNameAr: student.fullNameAr, fullNameEn: student.fullNameEn, dateOfBirth: student.dateOfBirth }).from(student);
  return {
    rooms,
    ctx: { rooms, today: todayInCairo(), existing, activeCount: await activeCount(tx, branchId), licensedCapacity: b?.licensed ?? 0 },
  };
}

function allowed(user: { grants: { role: string; branchId: string | null }[] }, branchId: string) {
  return hasRoleIn(user as never, ["company_manager"], branchId);
}

/** Step 1: read the spreadsheet and show what would be imported, with row errors in plain words. */
export async function previewImport(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const user = await getCurrentUser();
  const branchId = z.uuid().safeParse(fd.get("branchId"));
  if (!user || user.mustSetUpMfa || !branchId.success || !allowed(user, branchId.data)) return { status: "error", code: "forbidden" };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", code: "noFile" };
  if (file.size > MAX_FILE) return { status: "error", code: "badFile" };
  let rows: RawRow[];
  try {
    const sheet = await readSheet(await file.arrayBuffer(), columnForHeader);
    if (sheet.missing) return { status: "error", code: "badTemplate" };
    rows = sheet.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v])) as RawRow);
  } catch {
    return { status: "error", code: "badFile" };
  }
  if (rows.length === 0) return { status: "error", code: "noRows" };

  const locale = fd.get("locale") === "en" ? "en" : "ar";
  return withUserDb(user.id, async (tx) => {
    const { rooms, ctx } = await context(tx, branchId.data);
    const result = checkImportRows(rows, ctx);
    const roomName = new Map(rooms.map((r) => [r.id, locale === "ar" ? r.nameAr : r.nameEn]));
    return {
      status: "preview",
      fileName: file.name.slice(0, 200),
      rowsJson: JSON.stringify(rows),
      count: result.children.length,
      errors: result.errors.slice(0, 200),
      sample: result.children.slice(0, 200).map((c) => ({ row: c.row, name: locale === "ar" ? c.fullNameAr : c.fullNameEn, room: roomName.get(c.roomId) ?? "", bandOverride: c.bandOverride })),
    };
  });
}

/** Step 2: import every row as one batch, or nothing (the rows are checked again first). */
export async function commitImport(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const user = await getCurrentUser();
  const branchId = z.uuid().safeParse(fd.get("branchId"));
  if (!user || user.mustSetUpMfa || !branchId.success || !allowed(user, branchId.data)) return { status: "error", code: "forbidden" };
  let rows: RawRow[];
  try {
    rows = z.array(z.record(z.string(), z.unknown())).max(2000).parse(JSON.parse(String(fd.get("rowsJson") ?? "[]"))) as RawRow[];
  } catch {
    return { status: "error", code: "invalid" };
  }
  const fileName = String(fd.get("fileName") ?? "import.xlsx").slice(0, 200);
  const locale = fd.get("locale") === "en" ? "en" : "ar";

  try {
    const count = await withUserDb(
      user.id,
      async (tx) => {
        const { ctx } = await context(tx, branchId.data);
        const { children, errors } = checkImportRows(rows, ctx);
        if (errors.length || children.length === 0) return null;
        const [batch] = await tx
          .insert(importBatch)
          .values({ branchId: branchId.data, kind: "children", fileName, rowCount: children.length })
          .returning({ id: importBatch.id });

        const families = new Map<string, { id: string; guardians: Map<string, string> }>();
        for (const c of children) {
          let fam = families.get(c.familyRef);
          if (!fam) {
            const [{ no }] = (await tx.execute(sql`select app_next_family_no(${branchId.data}) as no`)) as unknown as { no: string }[];
            const [f] = await tx
              .insert(family)
              .values({ branchId: branchId.data, accountNo: no, displayName: c.guardians[0]?.fullName ?? c.fullNameEn, importBatchId: batch.id })
              .returning({ id: family.id });
            fam = { id: f.id, guardians: new Map() };
            families.set(c.familyRef, fam);
          }
          const links: string[] = [];
          for (const g of c.guardians) {
            let gid = fam.guardians.get(g.phone);
            if (!gid) {
              const [row] = await tx
                .insert(guardian)
                .values({ familyId: fam.id, branchId: branchId.data, fullName: g.fullName, relationship: g.relationship, phone: g.phone, importBatchId: batch.id })
                .returning({ id: guardian.id });
              gid = row.id;
              fam.guardians.set(g.phone, gid);
            }
            if (!links.includes(gid)) links.push(gid);
          }
          const [{ sno }] = (await tx.execute(sql`select app_next_student_no(${branchId.data}) as sno`)) as unknown as { sno: string }[];
          const [s] = await tx
            .insert(student)
            .values({ branchId: branchId.data, studentNo: sno, fullNameAr: c.fullNameAr, fullNameEn: c.fullNameEn, dateOfBirth: c.dateOfBirth, gender: c.gender, familyId: fam.id, status: "pending", importBatchId: batch.id })
            .returning({ id: student.id });
          for (const [i, gid] of links.entries()) {
            await tx.insert(studentGuardian).values({ studentId: s.id, guardianId: gid, branchId: branchId.data, canPickUp: true, isPrimaryContact: i === 0 });
          }
          if (c.recordsConsentOn) {
            await tx.insert(consentRecord).values({ studentId: s.id, branchId: branchId.data, guardianId: links[0] ?? null, purpose: "records", grantedOn: c.recordsConsentOn, language: locale });
          }
          await tx.insert(enrollment).values({
            studentId: s.id,
            branchId: branchId.data,
            roomId: c.roomId,
            startDate: c.startDate,
            status: "active",
            bandOverrideReason: c.bandOverride ? (locale === "ar" ? "مستورد من ملف إكسل" : "Imported from spreadsheet") : null,
            importBatchId: batch.id,
          });
        }
        return children.length;
      },
      { reason: `import ${fileName}` },
    );
    if (count === null) return { status: "error", code: "changed" };
    revalidatePath(`/${locale}/children`);
    return { status: "done", count };
  } catch (e) {
    const rule = dbRuleCode(e);
    if (rule) return { status: "error", code: rule };
    console.error("child import failed", dbErrorCode(e));
    return { status: "error", code: dbErrorCode(e) };
  }
}

export async function rollbackImport(fd: FormData) {
  const loc = fd.get("locale") === "en" ? "en" : "ar";
  const user = await requireUser(loc);
  const batchId = z.uuid().parse(fd.get("batchId"));
  const branchId = z.uuid().parse(fd.get("branchId"));
  await runAndReturn(loc, `/children/import?branch=${branchId}`, async () => {
    try {
      await withUserDb(user.id, (tx) => tx.execute(sql`select app_rollback_import(${batchId})`), { reason: "import rollback" });
    } catch (e) {
      const rule = dbRuleCode(e);
      if (rule) return { error: rule };
      throw e;
    }
  });
}
