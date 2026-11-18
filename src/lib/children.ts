/**
 * Children: ages, age bands, alerts, phone numbers and duplicate matching (spec §2.1, §8.1, §9.2).
 * Pure functions, unit-tested in tests/unit/children.test.ts.
 */

/** The nursery licence covers children from 3 months up to 4.5 years (spec §2.1). */
export const MIN_AGE_MONTHS = 3;
export const MAX_AGE_MONTHS = 54;
export const MOVING_UP_WINDOW_DAYS = 30;
export const LEAVING_WINDOW_DAYS = 60;

export const RELATIONSHIPS = ["mother", "father", "grandparent", "sibling", "relative", "nanny", "other"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
export const GENDERS = ["female", "male"] as const;
export const CONSENT_PURPOSES = ["records", "photos", "medical", "other"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const WITHDRAW_REASONS = ["moved", "cost", "school", "unhappy", "health", "other"] as const;

function parts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Whole months between two ISO dates, like PostgreSQL's age(): 2024-01-31 → 2024-02-29 is 0 months. */
export function ageInMonths(dob: string, on: string): number {
  const a = parts(dob);
  const b = parts(on);
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return months;
}

/** Adds months to an ISO date, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parts(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The date a child born on `dob` turns `months` months old. */
export function dateAtAge(dob: string, months: number): string {
  return addMonths(dob, months);
}

export interface Band {
  id: string;
  minAgeMonths: number;
  maxAgeMonths: number;
}

/** The age band a child of this age belongs in (min inclusive, max exclusive), or null outside 3–54 months. */
export function bandForAge<B extends Band>(months: number, bands: readonly B[]): B | null {
  return bands.find((b) => months >= b.minAgeMonths && months < b.maxAgeMonths) ?? null;
}

export function ageAllowed(months: number): boolean {
  return months >= MIN_AGE_MONTHS && months < MAX_AGE_MONTHS;
}

/** Room fits the child's age on that date? */
export function fitsBand(dob: string, on: string, band: Pick<Band, "minAgeMonths" | "maxAgeMonths">): boolean {
  const months = ageInMonths(dob, on);
  return months >= band.minAgeMonths && months < band.maxAgeMonths;
}

export interface ChildAlerts {
  /** Date the child outgrows the current room's age band, if within 30 days. */
  movingUpOn: string | null;
  /** Date the child reaches 4.5 years, if within 60 days. */
  leavingOn: string | null;
}

/** Spec §9.2 "Moving up / leaving soon". */
export function childAlerts(dob: string, band: Pick<Band, "maxAgeMonths"> | null, today: string): ChildAlerts {
  const leaving = dateAtAge(dob, MAX_AGE_MONTHS);
  const leavingOn = leaving >= today && leaving <= addDays(today, LEAVING_WINDOW_DAYS) ? leaving : null;
  let movingUpOn: string | null = null;
  if (band && band.maxAgeMonths < MAX_AGE_MONTHS) {
    const up = dateAtAge(dob, band.maxAgeMonths);
    if (up <= addDays(today, MOVING_UP_WINDOW_DAYS)) movingUpOn = up;
  }
  return { movingUpOn, leavingOn };
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

/** Converts Arabic-Indic and Persian digits to 0-9. */
export function latinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (c) => {
    const i = ARABIC_INDIC.indexOf(c);
    return String(i >= 0 ? i : PERSIAN.indexOf(c));
  });
}

/**
 * Egyptian mobile numbers as 11 digits starting 01 (e.g. 01012345678).
 * Accepts spaces, dashes, Arabic digits and the +20 / 0020 country code. Returns null if not a mobile number.
 */
export function normalizePhone(input: string): string | null {
  let v = latinDigits(input).replace(/[\s\-().]/g, "");
  if (v.startsWith("+20")) v = "0" + v.slice(3);
  else if (v.startsWith("0020")) v = "0" + v.slice(4);
  else if (/^20(1\d{9})$/.test(v)) v = "0" + v.slice(2);
  else if (/^1[0125]\d{8}$/.test(v)) v = "0" + v; // Excel drops the leading zero of a number
  return /^01[0125]\d{8}$/.test(v) ? v : null;
}

/** Normalizes a name for duplicate matching: case, spaces, Arabic letter variants and diacritics. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "") // harakat, dagger alif, tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DuplicateCandidate {
  id: string;
  fullNameAr: string;
  fullNameEn: string;
  dateOfBirth: string;
  phones: string[];
}

export type DuplicateReason = "nameAndBirth" | "phone";

/** Spec §8.1: same name + date of birth, or same guardian phone → ask before saving. */
export function findDuplicates(
  input: { fullNameAr: string; fullNameEn: string; dateOfBirth: string; phones: string[] },
  candidates: readonly DuplicateCandidate[],
): { id: string; reason: DuplicateReason }[] {
  const names = new Set([normalizeName(input.fullNameAr), normalizeName(input.fullNameEn)].filter(Boolean));
  const phones = new Set(input.phones.map((p) => normalizePhone(p)).filter((p): p is string => p !== null));
  const out: { id: string; reason: DuplicateReason }[] = [];
  for (const c of candidates) {
    const sameName = names.has(normalizeName(c.fullNameAr)) || names.has(normalizeName(c.fullNameEn));
    if (sameName && c.dateOfBirth === input.dateOfBirth) out.push({ id: c.id, reason: "nameAndBirth" });
    else if (c.phones.some((p) => phones.has(normalizePhone(p) ?? ""))) out.push({ id: c.id, reason: "phone" });
  }
  return out;
}

/** Occupancy against the licence (spec §9.2): share in whole percent, and whether the next child needs approval. */
export function occupancy(active: number, licensed: number) {
  return {
    active,
    licensed,
    percent: licensed > 0 ? Math.round((active / licensed) * 100) : 0,
    atCap: active >= licensed,
  };
}
