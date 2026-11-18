/**
 * Fingerprint (Hikvision) attendance files (spec §8.3, open item F7): column mapping saved per branch,
 * row checks, and the per-day result (first in, last out, late, absent).
 * Pure: the server reads the file into a table and passes it here. Unit-tested in tests/unit/staff-import.test.ts.
 */
import { addDays } from "./children";
import { cairoTimeOf, cairoWallToUtc, minutesOf, todayInCairo } from "./calendar";

/** What we need from the file. Either one date-and-time column, or a date column plus a time column. */
export const PUNCH_FIELDS = ["employeeNo", "name", "dateTime", "date", "time", "device"] as const;
export type PunchField = (typeof PUNCH_FIELDS)[number];
export type PunchMapping = Partial<Record<PunchField, string>>;

/** Header words seen in Hikvision exports (English and Arabic firmware), lower-cased. */
const HINTS: Record<PunchField, string[]> = {
  employeeNo: ["employee id", "employee no", "employee no.", "person id", "person no", "personnel id", "user id", "id", "no.", "الرقم", "رقم الموظف", "رقم الشخص", "معرف الموظف", "كود"],
  name: ["name", "person name", "employee name", "first name", "الاسم", "اسم الموظف", "اسم الشخص"],
  dateTime: ["time", "date time", "datetime", "date and time", "attendance time", "authentication time", "access time", "check time", "الوقت والتاريخ", "التاريخ والوقت", "وقت الحضور", "وقت التحقق"],
  date: ["date", "attendance date", "التاريخ"],
  time: ["clock", "punch time", "check-in time", "الوقت", "الساعة"],
  device: ["device", "device name", "terminal", "reader", "source", "الجهاز", "اسم الجهاز"],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** A first guess at the mapping from the file's headers; the person confirms or changes it. */
export function guessMapping(headers: string[]): PunchMapping {
  const out: PunchMapping = {};
  const taken = new Set<string>();
  for (const field of ["employeeNo", "name", "dateTime", "date", "time", "device"] as const) {
    const hit = headers.find((h) => !taken.has(h) && HINTS[field].includes(norm(h)));
    if (hit) {
      out[field] = hit;
      taken.add(hit);
    }
  }
  // "Time" alone usually holds the full date and time; with a separate "Date" column it is just the time.
  if (out.dateTime && out.date && !out.time) {
    out.time = out.dateTime;
    delete out.dateTime;
  }
  return out;
}

export function mappingProblems(m: PunchMapping, headers: string[]): ("employeeNo" | "when" | "unknownColumn")[] {
  const problems: ("employeeNo" | "when" | "unknownColumn")[] = [];
  if (!m.employeeNo) problems.push("employeeNo");
  if (!m.dateTime && !(m.date && m.time)) problems.push("when");
  if (Object.values(m).some((h) => h && !headers.includes(h))) problems.push("unknownColumn");
  return problems;
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const latin = (s: string) => s.replace(/[٠-٩]/g, (c) => String(ARABIC_INDIC.indexOf(c)));

type Cell = string | number | Date | null | undefined;

interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** Excel stores the device's wall-clock time; ExcelJS hands it over as if it were UTC. */
function wallFromExcelDate(v: Date): Wall {
  return { y: v.getUTCFullYear(), mo: v.getUTCMonth() + 1, d: v.getUTCDate(), h: v.getUTCHours(), mi: v.getUTCMinutes(), s: v.getUTCSeconds() };
}

/** Excel serial day number (e.g. 46344.33) → wall-clock parts. */
function wallFromSerial(n: number): Wall {
  const ms = Math.round((n - 25569) * 86400000);
  return wallFromExcelDate(new Date(ms));
}

function parseDatePart(s: string): { y: number; mo: number; d: number } | null {
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
  // Egypt writes day first: 18/11/2026.
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return { y: +m[3], mo: +m[2], d: +m[1] };
  return null;
}

function parseTimePart(s: string): { h: number; mi: number; s: number } | null {
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|ص|م)?$/i);
  if (!m) return null;
  let h = +m[1];
  const ampm = m[4]?.toLowerCase();
  if (ampm === "pm" || ampm === "م") h = h === 12 ? 12 : h + 12;
  if ((ampm === "am" || ampm === "ص") && h === 12) h = 0;
  return { h, mi: +m[2], s: m[3] ? +m[3] : 0 };
}

function validWall(w: Wall) {
  if (w.mo < 1 || w.mo > 12 || w.d < 1 || w.h > 23 || w.mi > 59 || w.s > 59) return false;
  const dt = new Date(Date.UTC(w.y, w.mo - 1, w.d));
  return dt.getUTCMonth() === w.mo - 1 && w.y >= 2000 && w.y <= 2100;
}

/** A punch time from one cell, or a date cell plus a time cell. Returns the real instant (Cairo wall clock → UTC). */
export function parsePunchTime(dateTime: Cell, dateCell?: Cell, timeCell?: Cell): Date | null {
  let wall: Wall | null = null;
  if (dateTime !== undefined && dateTime !== null && dateTime !== "") {
    if (dateTime instanceof Date) wall = wallFromExcelDate(dateTime);
    else if (typeof dateTime === "number") wall = wallFromSerial(dateTime);
    else {
      const s = latin(String(dateTime)).trim().replace("T", " ").replace(/\s+/g, " ");
      const [dPart, ...rest] = s.split(" ");
      const d = parseDatePart(dPart);
      const t = parseTimePart(rest.join(" "));
      if (d && t) wall = { ...d, ...t };
    }
  } else if (dateCell && timeCell) {
    let d: { y: number; mo: number; d: number } | null = null;
    if (dateCell instanceof Date) d = wallFromExcelDate(dateCell);
    else if (typeof dateCell === "number") d = wallFromSerial(dateCell);
    else d = parseDatePart(latin(String(dateCell)).trim());
    let t: { h: number; mi: number; s: number } | null = null;
    if (timeCell instanceof Date) t = wallFromExcelDate(timeCell);
    else if (typeof timeCell === "number") t = wallFromSerial(timeCell % 1);
    else t = parseTimePart(latin(String(timeCell)).trim());
    if (d && t) wall = { y: d.y, mo: d.mo, d: d.d, h: t.h, mi: t.mi, s: t.s };
  }
  if (!wall || !validWall(wall)) return null;
  return cairoWallToUtc(wall.y, wall.mo, wall.d, wall.h, wall.mi, wall.s);
}

export interface PunchRow {
  row: number;
  employeeNo: string;
  name: string | null;
  at: Date;
  device: string | null;
}

export type PunchErrorCode = "noEmployeeNo" | "badTime" | "future";

export interface PunchCheck {
  punches: PunchRow[];
  errors: { row: number; code: PunchErrorCode }[];
  /** Same person and same minute twice in the file: kept once. */
  duplicates: number;
  /** Device numbers not linked to anyone in this branch yet. */
  unknown: { employeeNo: string; name: string | null; count: number }[];
  /** First and last day (Cairo) the file covers. */
  from: string | null;
  to: string | null;
}

function cellText(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  // Excel turns "007" into 7; device numbers are compared as text without leading zeros.
  return latin(String(v)).trim();
}

/** Device numbers are matched without leading zeros ("0007" and "7" are the same person). */
export function normalizeEmployeeNo(v: string): string {
  const t = latin(v).trim();
  return /^\d+$/.test(t) ? String(BigInt(t)) : t;
}

/** Checks every row of the file. `rows` are keyed by header text; `knownNos` are the branch's device numbers. */
export function checkPunchRows(
  rows: { cells: Record<string, Cell>; row: number }[],
  mapping: PunchMapping,
  knownNos: ReadonlySet<string>,
  now = new Date(),
): PunchCheck {
  const punches: PunchRow[] = [];
  const errors: PunchCheck["errors"] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  const unknown = new Map<string, { employeeNo: string; name: string | null; count: number }>();
  const get = (r: Record<string, Cell>, f: PunchField) => (mapping[f] ? r[mapping[f]!] : undefined);

  for (const { cells, row } of rows) {
    const no = normalizeEmployeeNo(cellText(get(cells, "employeeNo")));
    if (!no) {
      errors.push({ row, code: "noEmployeeNo" });
      continue;
    }
    const at = parsePunchTime(get(cells, "dateTime"), get(cells, "date"), get(cells, "time"));
    if (!at) {
      errors.push({ row, code: "badTime" });
      continue;
    }
    if (at.getTime() > now.getTime() + 5 * 60000) {
      errors.push({ row, code: "future" });
      continue;
    }
    const key = `${no}|${Math.floor(at.getTime() / 60000)}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    const name = cellText(get(cells, "name")) || null;
    const device = cellText(get(cells, "device")) || null;
    // Keep whole minutes so a re-upload of the same file matches the punches already saved.
    punches.push({ row, employeeNo: no, name, at: new Date(Math.floor(at.getTime() / 60000) * 60000), device });
    if (!knownNos.has(no)) {
      const u = unknown.get(no) ?? { employeeNo: no, name, count: 0 };
      u.count++;
      unknown.set(no, u);
    }
  }
  const days = punches.map((p) => todayInCairo(p.at)).sort();
  return {
    punches,
    errors,
    duplicates,
    unknown: [...unknown.values()].sort((a, b) => a.employeeNo.localeCompare(b.employeeNo, "en", { numeric: true })),
    from: days[0] ?? null,
    to: days.at(-1) ?? null,
  };
}

export interface StaffForDays {
  id: string;
  shiftStart: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
}

export interface DayResult {
  staffId: string;
  date: string;
  firstIn: Date | null;
  lastOut: Date | null;
  status: "present" | "late" | "absent" | "leave";
}

/**
 * Spec §8.3: per person and day — first in, last out, late (after shift start + grace),
 * absent (working day, no punch, no leave). Days after `today` are not judged.
 * A day already marked as leave stays leave when there are no punches.
 */
export function deriveDays(input: {
  staff: StaffForDays[];
  punches: { staffId: string; at: Date }[];
  from: string;
  to: string;
  today: string;
  isWorkingDay: (date: string) => boolean;
  graceMinutes: number;
  leave?: ReadonlySet<string>; // `${staffId}|${date}`
  /** Minutes since midnight in Cairo now: today, nobody is absent before their shift (plus grace) has started. */
  nowMinutes?: number;
}): DayResult[] {
  const byKey = new Map<string, Date[]>();
  for (const p of input.punches) {
    const key = `${p.staffId}|${todayInCairo(p.at)}`;
    const list = byKey.get(key) ?? [];
    list.push(p.at);
    byKey.set(key, list);
  }
  const out: DayResult[] = [];
  const last = input.to < input.today ? input.to : input.today;
  for (let d = input.from; d <= last; d = addDays(d, 1)) {
    for (const s of input.staff) {
      const times = (byKey.get(`${s.id}|${d}`) ?? []).sort((a, b) => a.getTime() - b.getTime());
      const employed = (!s.startDate || s.startDate <= d) && (!s.endDate || s.endDate >= d);
      if (times.length) {
        const firstIn = times[0];
        const late = minutesOf(cairoTimeOf(firstIn)) > minutesOf(s.shiftStart) + input.graceMinutes;
        out.push({ staffId: s.id, date: d, firstIn, lastOut: times.length > 1 ? times.at(-1)! : null, status: late ? "late" : "present" });
      } else if (input.leave?.has(`${s.id}|${d}`)) {
        out.push({ staffId: s.id, date: d, firstIn: null, lastOut: null, status: "leave" });
      } else if (
        employed &&
        s.status === "active" &&
        input.isWorkingDay(d) &&
        !(d === input.today && input.nowMinutes !== undefined && input.nowMinutes <= minutesOf(s.shiftStart) + input.graceMinutes)
      ) {
        out.push({ staffId: s.id, date: d, firstIn: null, lastOut: null, status: "absent" });
      }
    }
  }
  return out;
}
