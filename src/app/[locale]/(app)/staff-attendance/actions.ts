"use server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUserDb, dbErrorCode } from "@/db/rls";
import { importBatch, importMapping, staff, staffPunch } from "@/db/schema";
import { knownDeviceNos, rederiveStaffDays } from "@/db/staff-days";
import { getCurrentUser } from "@/lib/session";
import { requireUser } from "@/lib/require-user";
import { runAndReturn } from "@/lib/action-result";
import { canImportPunches } from "@/lib/permissions";
import { readTable } from "@/lib/excel";
import { PUNCH_FIELDS, checkPunchRows, guessMapping, mappingProblems, normalizeEmployeeNo, type PunchCheck, type PunchMapping } from "@/lib/staff-import";
import { todayInCairo } from "@/lib/calendar";

const MAX_FILE = 10 * 1024 * 1024;
const KIND = "staff_punches";

export type PunchImportState =
  | { status: "idle" }
  | { status: "error"; code: string }
  | {
      status: "preview";
      headers: string[];
      mapping: PunchMapping;
      problems: string[];
      count: number;
      errors: PunchCheck["errors"];
      duplicates: number;
      unknown: PunchCheck["unknown"];
      from: string | null;
      to: string | null;
      sample: { row: number; employeeNo: string; name: string | null; at: string }[];
      staffOptions: { id: string; name: string }[];
    }
  | { status: "done"; count: number; skipped: number; days: number; batchId: string };

function readMapping(fd: FormData): PunchMapping | null {
  if (fd.get("mapped") !== "1") return null;
  const m: PunchMapping = {};
  for (const f of PUNCH_FIELDS) {
    const v = String(fd.get(`map_${f}`) ?? "");
    if (v) m[f] = v;
  }
  return m;
}

/**
 * Fingerprint file upload (spec §8.3): first time, map the columns (saved per branch); then check every row;
 * then save as one batch that can be undone. Unknown device numbers can be linked to staff on the way.
 */
export async function punchImport(_prev: PunchImportState, fd: FormData): Promise<PunchImportState> {
  const user = await getCurrentUser();
  const branchId = z.uuid().safeParse(fd.get("branchId"));
  if (!user || user.mustSetUpMfa || !branchId.success || !canImportPunches(user, branchId.data)) return { status: "error", code: "forbidden" };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", code: "noFile" };
  if (file.size > MAX_FILE) return { status: "error", code: "badFile" };
  let table: Awaited<ReturnType<typeof readTable>>;
  try {
    table = await readTable(await file.arrayBuffer(), file.name);
  } catch {
    return { status: "error", code: "badFile" };
  }
  if (!table.headers.length || !table.rows.length) return { status: "error", code: "emptyFile" };
  const commit = fd.get("intent") === "commit";
  const bId = branchId.data;

  try {
    return await withUserDb(user.id, async (tx): Promise<PunchImportState> => {
      const [saved] = await tx.select({ mapping: importMapping.mapping }).from(importMapping).where(and(eq(importMapping.branchId, bId), eq(importMapping.kind, KIND)));
      const savedMapping = saved?.mapping as PunchMapping | undefined;
      const fromForm = readMapping(fd);
      const mapping =
        fromForm ?? (savedMapping && mappingProblems(savedMapping, table.headers).length === 0 ? savedMapping : guessMapping(table.headers));
      const problems = mappingProblems(mapping, table.headers);

      // Links chosen for unknown device numbers: link_<no> = staff id.
      const links = new Map<string, string>();
      for (const [k, v] of fd.entries()) {
        if (k.startsWith("link_") && typeof v === "string" && z.uuid().safeParse(v).success) links.set(k.slice(5), v);
      }

      const known = await knownDeviceNos(tx, bId);
      const knownSet = new Set(known.map((k) => normalizeEmployeeNo(k.no!)));
      for (const no of links.keys()) knownSet.add(no);
      const check = problems.length ? null : checkPunchRows(table.rows, mapping, knownSet);

      const staffRows = await tx
        .select({ id: staff.id, nameAr: staff.fullNameAr, nameEn: staff.fullNameEn, no: staff.deviceEmployeeNo })
        .from(staff)
        .where(and(eq(staff.branchId, bId), eq(staff.status, "active")));

      if (!commit || !check || problems.length) {
        return {
          status: "preview",
          headers: table.headers,
          mapping,
          problems,
          count: check?.punches.length ?? 0,
          errors: check?.errors.slice(0, 200) ?? [],
          duplicates: check?.duplicates ?? 0,
          unknown: check?.unknown ?? [],
          from: check?.from ?? null,
          to: check?.to ?? null,
          sample: (check?.punches ?? []).slice(0, 8).map((p) => ({ row: p.row, employeeNo: p.employeeNo, name: p.name, at: p.at.toISOString() })),
          staffOptions: staffRows
            .filter((s) => !s.no)
            .map((s) => ({ id: s.id, name: fd.get("locale") === "en" ? s.nameEn : s.nameAr })),
        };
      }

      // Commit: remember the mapping, link the new numbers, save the punches, work out the days.
      await tx
        .insert(importMapping)
        .values({ branchId: bId, kind: KIND, mapping })
        .onConflictDoUpdate({ target: [importMapping.branchId, importMapping.kind], set: { mapping } });
      for (const [no, staffId] of links) await tx.execute(sql`select app_set_staff_device_no(${staffId}, ${no})`);

      const byNo = new Map<string, string>();
      for (const s of await knownDeviceNos(tx, bId)) byNo.set(normalizeEmployeeNo(s.no!), s.id);

      const [batch] = await tx.insert(importBatch).values({ branchId: bId, kind: KIND, fileName: file.name.slice(0, 200), rowCount: 0 }).returning({ id: importBatch.id });
      let inserted = 0;
      for (let i = 0; i < check.punches.length; i += 500) {
        const rows = await tx
          .insert(staffPunch)
          .values(
            check.punches.slice(i, i + 500).map((p) => ({
              branchId: bId,
              staffId: byNo.get(p.employeeNo) ?? null,
              deviceEmployeeNo: p.employeeNo,
              personName: p.name,
              punchedAt: p.at,
              device: p.device,
              importBatchId: batch.id,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: staffPunch.id });
        inserted += rows.length;
      }
      await tx.update(importBatch).set({ rowCount: inserted }).where(eq(importBatch.id, batch.id));
      const days = check.from && check.to ? await rederiveStaffDays(tx, bId, check.from, check.to) : 0;
      return { status: "done", count: inserted, skipped: check.punches.length - inserted, days, batchId: batch.id };
    });
  } catch (e) {
    console.error("punch import failed", dbErrorCode(e));
    return { status: "error", code: dbErrorCode(e) };
  } finally {
    revalidatePath(`/${fd.get("locale") === "en" ? "en" : "ar"}/staff-attendance`);
  }
}

/** One-step undo of a fingerprint file (rule 13): removes its punches and works the days out again. */
export async function rollbackPunchImport(fd: FormData) {
  const loc = fd.get("locale") === "en" ? "en" : "ar";
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const batchId = z.uuid().parse(fd.get("batchId"));
  await runAndReturn(loc, `/staff-attendance?branch=${branchId}`, async () => {
    if (!canImportPunches(user, branchId)) return { error: "forbidden" };
    await withUserDb(user.id, async (tx) => {
      const [b] = await tx
        .select({ id: importBatch.id })
        .from(importBatch)
        .where(and(eq(importBatch.id, batchId), eq(importBatch.branchId, branchId), eq(importBatch.kind, KIND), eq(importBatch.status, "committed"), isNull(importBatch.rolledBackAt)));
      if (!b) return;
      const [range] = (await tx.execute(
        sql`select min((punched_at at time zone 'Africa/Cairo')::date)::text as "from", max((punched_at at time zone 'Africa/Cairo')::date)::text as "to" from staff_punch where import_batch_id = ${batchId}`,
      )) as unknown as { from: string | null; to: string | null }[];
      await tx.delete(staffPunch).where(eq(staffPunch.importBatchId, batchId));
      await tx.update(importBatch).set({ status: "rolled_back", rolledBackAt: new Date() }).where(eq(importBatch.id, batchId));
      if (range?.from && range.to) await rederiveStaffDays(tx, branchId, range.from, range.to < todayInCairo() ? range.to : todayInCairo());
    }, { reason: "fingerprint file undone" });
  });
}
