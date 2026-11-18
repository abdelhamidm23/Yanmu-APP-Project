import ExcelJS from "exceljs";
import { and, eq, isNotNull } from "drizzle-orm";
import { withUserDb } from "@/db/rls";
import { staff } from "@/db/schema";
import type { CurrentUser } from "@/lib/session";
import { addDays } from "@/lib/children";
import { todayInCairo } from "@/lib/calendar";
import { xlsxResponse } from "@/lib/excel";

/**
 * Demo mode only: a made-up fingerprint file laid out like a Hikvision export, for the branch's
 * staff on the last working day, so the upload can be tried without a machine. It includes one
 * number nobody has and one row without a number, to show how those are handled.
 */
export async function samplePunchFile(user: CurrentUser, branchId: string): Promise<Response> {
  const people = await withUserDb(user.id, (tx) =>
    tx
      .select({ no: staff.deviceEmployeeNo, name: staff.fullNameEn })
      .from(staff)
      .where(and(eq(staff.branchId, branchId), eq(staff.status, "active"), isNotNull(staff.deviceEmployeeNo)))
      .orderBy(staff.deviceEmployeeNo),
  );
  let day = addDays(todayInCairo(), -1);
  // Friday and Saturday are the default days off.
  while ([5, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = addDays(day, -1);

  let seed = people.length * 7919 + 17;
  const rand = (min: number, max: number) => min + ((seed = (seed * 48271) % 2147483647) % (max - min + 1));
  const at = (h: number, m: number) => `${day} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(rand(0, 59)).padStart(2, "0")}`;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Attendance Record");
  ws.columns = ["Person ID", "Name", "Department", "Time", "Attendance Status", "Device Name"].map((header) => ({ header, width: 22 }));
  ws.getRow(1).font = { bold: true };
  ws.getColumn(1).numFmt = "@";
  people.forEach((p, i) => {
    if (i === 2) return; // one person did not come
    const late = i === 5;
    ws.addRow([p.no, p.name, "Nursery", at(late ? 8 : 7, late ? rand(15, 40) : rand(30, 59)), "Check-in", "Entrance"]);
    ws.addRow([p.no, p.name, "Nursery", at(16, rand(0, 50)), "Check-out", "Entrance"]);
  });
  ws.addRow(["999", "Visitor (sample)", "", at(10, 5), "Check-in", "Entrance"]);
  ws.addRow(["", "No number (sample)", "", at(9, 0), "Check-in", "Entrance"]);
  return xlsxResponse(Buffer.from(await wb.xlsx.writeBuffer()), `sample-fingerprint-${day}.xlsx`);
}
