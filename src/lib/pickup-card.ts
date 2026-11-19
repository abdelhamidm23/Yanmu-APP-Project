/**
 * Private pickup links (owner, 2026-11-19). An approved adult gets a link that shows today's
 * pickup QR codes for the children they may collect (src/lib/pickup-code.ts). The link carries a
 * random secret; the database keeps only its SHA-256 (table `pickup_card`, one link in use per adult).
 */
import { createHash, randomBytes } from "node:crypto";

/** 128 random bits, URL-safe. */
export function newPickupLinkSecret(): string {
  return randomBytes(16).toString("base64url");
}

export function hashPickupLinkSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function isPickupLinkSecret(text: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(text);
}
