import "server-only";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** Cookie on a shared class phone holding one random token per person who set up quick sign-in. */
export const DEVICE_COOKIE = "yanmu_device";
export const MAX_PEOPLE_PER_PHONE = 12;
/** Wrong PINs before the phone forgets the person (they sign in with their password again). */
export const MAX_PIN_ATTEMPTS = 5;
/** Spec §14: shared class phones sign out after 30 minutes without use. */
export const SHARED_IDLE_MINUTES = 30;

export const PIN_PATTERN = /^\d{4,6}$/;

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return ["scrypt", salt.toString("base64url"), key.toString("base64url")].join(":");
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [kind, salt, hash] = stored.split(":");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(pin, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(key, expected);
}

export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Tokens are base64url, so a dot separates them safely. */
export function readDeviceTokens(cookieValue: string | undefined | null): string[] {
  return (cookieValue ?? "")
    .split(".")
    .filter((t) => /^[A-Za-z0-9_-]{40,60}$/.test(t))
    .slice(0, MAX_PEOPLE_PER_PHONE);
}

export function writeDeviceTokens(tokens: string[]): string {
  return [...new Set(tokens)].slice(-MAX_PEOPLE_PER_PHONE).join(".");
}

export const deviceCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && !(process.env.BETTER_AUTH_URL ?? "").startsWith("http://"),
  path: "/",
  maxAge: 60 * 60 * 24 * 180,
};
