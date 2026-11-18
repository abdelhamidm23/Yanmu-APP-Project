/**
 * Child import (spec §8.11, rule 13): template columns and row checks.
 * Pure: the server reads the spreadsheet into plain rows and passes them here.
 */
import {
  GENDERS,
  MAX_AGE_MONTHS,
  RELATIONSHIPS,
  ageInMonths,
  fitsBand,
  normalizeName,
  normalizePhone,
  type Relationship,
} from "./children";

/** Columns of the template. Headers are accepted in Arabic or English. */
export const IMPORT_COLUMNS = [
  { key: "familyRef", en: "Family ref", ar: "رقم العائلة", required: true, example: "1" },
  { key: "fullNameAr", en: "Child name (Arabic)", ar: "اسم الطفل (عربي)", required: true, example: "ليلى أحمد حسن" },
  { key: "fullNameEn", en: "Child name (English)", ar: "اسم الطفل (إنجليزي)", required: true, example: "Laila Ahmed Hassan" },
  { key: "dateOfBirth", en: "Date of birth", ar: "تاريخ الميلاد", required: true, example: "2024-05-14" },
  { key: "gender", en: "Gender (female/male)", ar: "النوع (أنثى/ذكر)", required: true, example: "female" },
  { key: "room", en: "Room", ar: "الفصل", required: true, example: "Toddlers 1" },
  { key: "startDate", en: "Start date", ar: "تاريخ البدء", required: true, example: "2025-09-01" },
  { key: "guardian1Name", en: "Guardian 1 name", ar: "اسم ولي الأمر ١", required: true, example: "Mona Ali" },
  { key: "guardian1Relationship", en: "Guardian 1 relationship", ar: "صلة ولي الأمر ١", required: true, example: "mother" },
  { key: "guardian1Phone", en: "Guardian 1 phone", ar: "هاتف ولي الأمر ١", required: true, example: "01012345678" },
  { key: "guardian2Name", en: "Guardian 2 name", ar: "اسم ولي الأمر ٢", required: false, example: "Ahmed Hassan" },
  { key: "guardian2Relationship", en: "Guardian 2 relationship", ar: "صلة ولي الأمر ٢", required: false, example: "father" },
  { key: "guardian2Phone", en: "Guardian 2 phone", ar: "هاتف ولي الأمر ٢", required: false, example: "01112345678" },
  { key: "recordsConsentOn", en: "Records consent signed on", ar: "تاريخ توقيع موافقة السجلات", required: false, example: "2025-08-20" },
] as const;

export type ImportKey = (typeof IMPORT_COLUMNS)[number]["key"];
/** One spreadsheet row; `__row` is its row number in the file (header = 1). */
export type RawRow = Partial<Record<ImportKey, unknown>> & { __row?: number };

/** Arabic words people type for the fixed choices. */
const GENDER_WORDS: Record<string, (typeof GENDERS)[number]> = {
  female: "female", f: "female", girl: "female", "أنثى": "female", "انثى": "female", "بنت": "female",
  male: "male", m: "male", boy: "male", "ذكر": "male", "ولد": "male",
};
const RELATIONSHIP_WORDS: Record<string, Relationship> = {
  "أم": "mother", "ام": "mother", "والدة": "mother",
  "أب": "father", "اب": "father", "والد": "father",
  "جد": "grandparent", "جدة": "grandparent", grandmother: "grandparent", grandfather: "grandparent",
  "أخ": "sibling", "اخ": "sibling", "أخت": "sibling", "اخت": "sibling", brother: "sibling", sister: "sibling",
  "قريب": "relative", "قريبة": "relative", "خال": "relative", "خالة": "relative", "عم": "relative", "عمة": "relative",
  "مربية": "nanny", "دادة": "nanny",
  "أخرى": "other", "اخرى": "other",
};

/** Same words after normalizeName(), so "أنثى", "انثى" and "انثي" all match. */
const GENDER_LOOKUP = new Map(Object.entries(GENDER_WORDS).map(([k, v]) => [normalizeName(k), v]));
const RELATIONSHIP_LOOKUP = new Map<string, Relationship>([
  ...RELATIONSHIPS.map((r) => [r, r] as [string, Relationship]),
  ...Object.entries(RELATIONSHIP_WORDS).map(([k, v]) => [normalizeName(k), v] as [string, Relationship]),
]);

export type ImportErrorCode =
  | "required"
  | "badDate"
  | "badGender"
  | "badRelationship"
  | "badPhone"
  | "unknownRoom"
  | "tooOld"
  | "tooYoung"
  | "futureBirth"
  | "duplicateInFile"
  | "alreadyEnrolled"
  | "familyMismatch"
  | "overCapacity";

export interface ImportError {
  /** Spreadsheet row number (header is row 1). */
  row: number;
  column: ImportKey | null;
  code: ImportErrorCode;
}

export interface ParsedGuardian {
  fullName: string;
  relationship: Relationship;
  phone: string;
}

export interface ParsedChild {
  row: number;
  familyRef: string;
  fullNameAr: string;
  fullNameEn: string;
  dateOfBirth: string;
  gender: (typeof GENDERS)[number];
  roomId: string;
  startDate: string;
  /** The room is for another age band; the import records why. */
  bandOverride: boolean;
  guardians: ParsedGuardian[];
  recordsConsentOn: string | null;
}

export interface ImportRoom {
  id: string;
  nameAr: string;
  nameEn: string;
  minAgeMonths: number;
  maxAgeMonths: number;
}

export interface ImportContext {
  rooms: readonly ImportRoom[];
  today: string;
  /** Children already in the system (name + birth date), to avoid importing twice. */
  existing: readonly { fullNameAr: string; fullNameEn: string; dateOfBirth: string }[];
  activeCount: number;
  licensedCapacity: number;
}

/** Maps a header cell to a column key, in either language. */
export function columnForHeader(header: unknown): ImportKey | null {
  const h = normalizeName(String(header ?? ""));
  const col = IMPORT_COLUMNS.find((c) => normalizeName(c.en) === h || normalizeName(c.ar) === h || c.key.toLowerCase() === h);
  return col?.key ?? null;
}

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null && "text" in v) return String((v as { text: unknown }).text).trim();
  return String(v).trim();
}

/** Accepts a real date cell, 2025-09-01, 1/9/2025 or 01-09-2025 (day first, as written in Egypt). */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = text(v).replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

function parseRelationship(v: string): Relationship | null {
  return RELATIONSHIP_LOOKUP.get(normalizeName(v)) ?? null;
}

/**
 * Checks every row and returns the children ready to import plus row errors in plain codes.
 * Nothing is imported unless there are no errors (the screen asks the person to fix the file).
 */
export function checkImportRows(rows: readonly RawRow[], ctx: ImportContext): { children: ParsedChild[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const children: ParsedChild[] = [];
  const seen = new Map<string, number>();
  const existing = new Set(ctx.existing.flatMap((e) => [`${normalizeName(e.fullNameAr)}|${e.dateOfBirth}`, `${normalizeName(e.fullNameEn)}|${e.dateOfBirth}`]));
  const familyPhones = new Map<string, Set<string>>();

  rows.forEach((raw, i) => {
    const row = raw.__row ?? i + 2;
    const rowErrors: ImportError[] = [];
    const err = (column: ImportKey | null, code: ImportErrorCode) => rowErrors.push({ row, column, code });

    for (const c of IMPORT_COLUMNS) if (c.required && !text(raw[c.key])) err(c.key, "required");
    const familyRef = text(raw.familyRef);
    const fullNameAr = text(raw.fullNameAr);
    const fullNameEn = text(raw.fullNameEn);

    const dob = text(raw.dateOfBirth) || raw.dateOfBirth instanceof Date ? parseDate(raw.dateOfBirth) : null; // (a || b) ? … : …
    if (text(raw.dateOfBirth) && !dob) err("dateOfBirth", "badDate");
    const start = text(raw.startDate) || raw.startDate instanceof Date ? parseDate(raw.startDate) : null;
    if (text(raw.startDate) && !start) err("startDate", "badDate");

    const genderText = normalizeName(text(raw.gender));
    const gender = GENDER_LOOKUP.get(genderText);
    if (genderText && !gender) err("gender", "badGender");

    const roomText = normalizeName(text(raw.room));
    const room = ctx.rooms.find((r) => normalizeName(r.nameEn) === roomText || normalizeName(r.nameAr) === roomText);
    if (roomText && !room) err("room", "unknownRoom");

    if (dob) {
      if (dob > ctx.today) err("dateOfBirth", "futureBirth");
      else if (ageInMonths(dob, ctx.today) >= MAX_AGE_MONTHS) err("dateOfBirth", "tooOld");
      else if (start && ageInMonths(dob, start) < 3 && start >= ctx.today) err("startDate", "tooYoung");
    }

    const guardians: ParsedGuardian[] = [];
    for (const n of [1, 2] as const) {
      const name = text(raw[`guardian${n}Name`]);
      const relText = text(raw[`guardian${n}Relationship`]);
      const phoneText = text(raw[`guardian${n}Phone`]);
      if (n === 2 && !name && !relText && !phoneText) continue;
      if (n === 2 && !name) err("guardian2Name", "required");
      const relationship = relText ? parseRelationship(relText) : null;
      if (relText && !relationship) err(`guardian${n}Relationship`, "badRelationship");
      if (n === 2 && !relText) err("guardian2Relationship", "required");
      const phone = phoneText ? normalizePhone(phoneText) : null;
      if (phoneText && !phone) err(`guardian${n}Phone`, "badPhone");
      if (n === 2 && !phoneText) err("guardian2Phone", "required");
      if (name && relationship && phone) guardians.push({ fullName: name, relationship, phone });
    }

    const consentText = text(raw.recordsConsentOn);
    const recordsConsentOn = consentText || raw.recordsConsentOn instanceof Date ? parseDate(raw.recordsConsentOn) : null;
    if (consentText && !recordsConsentOn) err("recordsConsentOn", "badDate");

    if (dob && fullNameAr) {
      const key = `${normalizeName(fullNameAr)}|${dob}`;
      if (seen.has(key)) err("fullNameAr", "duplicateInFile");
      else seen.set(key, row);
      if (existing.has(key) || existing.has(`${normalizeName(fullNameEn)}|${dob}`)) err("fullNameAr", "alreadyEnrolled");
    }

    // Children sharing a family ref must share at least one guardian phone (catches typos in the ref).
    if (familyRef && guardians.length) {
      const phones = new Set(guardians.map((g) => g.phone));
      const known = familyPhones.get(familyRef);
      if (known && ![...phones].some((p) => known.has(p))) err("familyRef", "familyMismatch");
      else familyPhones.set(familyRef, new Set([...(known ?? []), ...phones]));
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    children.push({
      row,
      familyRef,
      fullNameAr,
      fullNameEn,
      dateOfBirth: dob!,
      gender: gender!,
      roomId: room!.id,
      startDate: start!,
      bandOverride: !fitsBand(dob!, start! > ctx.today ? start! : ctx.today, room!),
      guardians,
      recordsConsentOn,
    });
  });

  // Spec D11: the licence cap applies to imports too; past it, the owner approves children one by one.
  const room = ctx.licensedCapacity - ctx.activeCount;
  if (errors.length === 0 && children.length > room) {
    for (const c of children.slice(Math.max(room, 0))) errors.push({ row: c.row, column: null, code: "overCapacity" });
  }
  return { children: errors.length ? [] : children, errors };
}
