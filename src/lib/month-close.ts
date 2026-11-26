import { parseEgpToPiastres } from "./format";

/**
 * The month-close template (spec §8.10): one row per line, with a code the app reads back.
 *   check:billed / check:late_fees / check:collected / check:expense:<category>
 *       the app's figure is filled in; the accountant writes their own beside it, and a note when they differ.
 *   central:<category>  costs not recorded in the app (salaries, rent, security …), written by the accountant.
 *   balance:cash / balance:bank  reconciled balances at the end of the month.
 * Columns: A code · B line · C app figure (EGP) · D your figure (EGP) · E note.
 */
export const CENTRAL_KEYS = ["salaries", "security", "marketing", "rent", "utilities", "admin", "other"] as const;
export const BALANCE_KEYS = ["cash", "bank"] as const;

export type LineKind = "check" | "central" | "balance";
export type TemplateLine = { code: string; kind: LineKind; label: string; app: bigint | null; categoryId: string | null };
export type ParsedLine = { code: string; kind: LineKind; categoryId: string | null; app: bigint | null; amount: bigint; note: string | null; row: number };
export type TemplateError = { row: number; code: "unknownCode" | "notNumber" | "duplicate" | "noteRequired" | "missing"; line?: string };

/** "12,345.50" ← piastres, for the spreadsheet (a text cell keeps the exact value). */
export function egpText(p: bigint | null): string {
  if (p === null) return "";
  const neg = p < 0n;
  const a = neg ? -p : p;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
}

/** A cell as piastres: numbers (Excel) and text ("12,345.50", "١٢٣") are both accepted. */
export function cellPiastres(v: unknown): bigint | null | "bad" {
  if (v === null || v === undefined) return null;
  let s = typeof v === "number" ? v.toFixed(2) : String(v);
  s = s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[٫]/g, ".").replace(/[٬،]/g, ",").trim();
  if (s === "" || s === "-" || s === "—") return null;
  try {
    return parseEgpToPiastres(s);
  } catch {
    return "bad";
  }
}

/** Reads the uploaded rows back against the lines the app expects. */
export function parseTemplate(rows: { row: number; values: unknown[] }[], lines: TemplateLine[]): { lines: ParsedLine[]; errors: TemplateError[] } {
  const known = new Map(lines.map((l) => [l.code, l]));
  const seen = new Set<string>();
  const out: ParsedLine[] = [];
  const errors: TemplateError[] = [];
  for (const r of rows) {
    const code = String(r.values[0] ?? "").trim();
    if (!code) continue;
    const line = known.get(code);
    if (!line) {
      errors.push({ row: r.row, code: "unknownCode", line: code });
      continue;
    }
    if (seen.has(code)) {
      errors.push({ row: r.row, code: "duplicate", line: line.label });
      continue;
    }
    seen.add(code);
    const amount = cellPiastres(r.values[3]);
    const note = String(r.values[4] ?? "").trim() || null;
    if (amount === "bad") {
      errors.push({ row: r.row, code: "notNumber", line: line.label });
      continue;
    }
    if (amount === null) {
      // A check line must be answered; central costs and balances may be left empty (not known yet).
      if (line.kind === "check") errors.push({ row: r.row, code: "missing", line: line.label });
      continue;
    }
    if (line.kind === "check" && amount !== line.app && (!note || note.length < 3)) {
      errors.push({ row: r.row, code: "noteRequired", line: line.label });
      continue;
    }
    out.push({ code, kind: line.kind, categoryId: line.categoryId, app: line.app, amount, note, row: r.row });
  }
  for (const l of lines) if (l.kind === "check" && !seen.has(l.code)) errors.push({ row: 0, code: "missing", line: l.label });
  return { lines: out, errors };
}
