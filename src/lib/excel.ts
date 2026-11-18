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

/** Plain value of an ExcelJS cell: text, number or Date (formulas give their result, links their text). */
function cellPlain(v: ExcelJS.CellValue): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return cellPlain(v.result as ExcelJS.CellValue);
  }
  return String(v);
}

/**
 * Reads the first sheet of an .xlsx: row 1 is the header. Returns one object per non-empty row,
 * keyed by `columnFor(header)`. Unknown headers are ignored.
 */
export async function readSheet<K extends string>(
  data: ArrayBuffer,
  columnFor: (header: unknown) => K | null,
  maxRows = 2000,
): Promise<{ rows: (Partial<Record<K, string | number | Date>> & { __row: number })[]; missing: boolean }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], missing: true };
  const keys = new Map<number, K>();
  ws.getRow(1).eachCell((cell, col) => {
    const k = columnFor(cellPlain(cell.value));
    if (k) keys.set(col, k);
  });
  const rows: (Partial<Record<K, string | number | Date>> & { __row: number })[] = [];
  for (let r = 2; r <= Math.min(ws.rowCount, maxRows + 1); r++) {
    const row = ws.getRow(r);
    const out: Partial<Record<K, string | number | Date>> = {};
    let any = false;
    for (const [col, k] of keys) {
      const v = cellPlain(row.getCell(col).value);
      if (v !== null && String(v).trim() !== "") {
        out[k] = v;
        any = true;
      }
    }
    if (any) rows.push({ ...out, __row: r });
  }
  return { rows, missing: keys.size === 0 };
}
