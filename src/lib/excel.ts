import "server-only";
import ExcelJS from "exceljs";

export interface SheetColumn {
  header: string;
  width?: number;
}

/** Builds a one-sheet .xlsx. Arabic sheets read right to left. */
export async function buildWorkbook(title: string, columns: SheetColumn[], rows: (string | number | null)[][], locale: "ar" | "en") {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Nursery Command Center";
  const ws = wb.addWorksheet(title.slice(0, 31), { views: [{ rightToLeft: locale === "ar", state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width ?? 20 }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r.map((v) => v ?? ""));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function xlsxResponse(body: Buffer, filename: string) {
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
