/**
 * Daily pickup QR codes (owner, 2026-11-19). Every child gets a new code each day; the approved
 * adult shows it (or a screenshot) at pickup and the front desk scans it. Yesterday's screenshot
 * does not work today.
 *
 * Codes are never stored. A code is HMAC-SHA256(secret, child | date | version), shortened to
 * 10 letters and digits (about 50 bits), so it is also short enough to type when a camera fails.
 * Bumping `student.pickup_code_version` gives the child a new code for the rest of the day.
 * The QR holds only "YANMU-PICKUP:" and the code: no name, no number.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const PICKUP_QR_PREFIX = "YANMU-PICKUP:";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base 32: no I, L, O, U
export const CODE_LENGTH = 10;

function secret(): string {
  const s = process.env.PICKUP_CODE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("PICKUP_CODE_SECRET or BETTER_AUTH_SECRET must be set");
  return s;
}

function toBase32(bytes: Buffer, length: number): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
    if (out.length >= length) break;
  }
  return out;
}

/** The child's pickup code for one day (Cairo date, YYYY-MM-DD). */
export function dailyPickupCode(studentId: string, date: string, version: number, key = secret()): string {
  const mac = createHmac("sha256", key).update(`pickup|${studentId}|${date}|${version}`).digest();
  return toBase32(mac, CODE_LENGTH);
}

/** What goes into the QR. */
export function pickupQrText(code: string): string {
  return PICKUP_QR_PREFIX + code;
}

/** "K7QD3XPA9M" → "K7QD3-XPA9M", easier to read aloud or type. */
export function formatPickupCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * The code from a scanned QR or a typed code, or null if it cannot be one of ours.
 * Typing is forgiving: spaces and dashes are ignored, lower case is fine, and O/I/L read as 0/1/1.
 */
export function readPickupInput(text: string): string | null {
  let t = text.trim();
  if (t.toUpperCase().startsWith(PICKUP_QR_PREFIX)) t = t.slice(PICKUP_QR_PREFIX.length);
  const code = t
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

/** Equal codes, compared in constant time. */
export function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Which of these children the code belongs to: "today" for today's code, "old" when it is
 * yesterday's (a stale screenshot), or null when it matches nobody.
 */
export function matchPickupCode<C extends { id: string; pickupCodeVersion: number }>(
  code: string,
  children: C[],
  today: string,
  yesterday: string,
  key = secret(),
): { child: C; when: "today" | "old" } | null {
  for (const c of children) if (sameCode(dailyPickupCode(c.id, today, c.pickupCodeVersion, key), code)) return { child: c, when: "today" };
  for (const c of children) {
    for (let v = 0; v <= c.pickupCodeVersion; v++) {
      if (sameCode(dailyPickupCode(c.id, yesterday, v, key), code)) return { child: c, when: "old" };
    }
    // An earlier code from today that was replaced is "old" too.
    for (let v = 0; v < c.pickupCodeVersion; v++) {
      if (sameCode(dailyPickupCode(c.id, today, v, key), code)) return { child: c, when: "old" };
    }
  }
  return null;
}
