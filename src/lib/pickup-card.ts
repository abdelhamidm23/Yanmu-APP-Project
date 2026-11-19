/**
 * QR pickup cards (owner's review of phase 3). A card carries a random code and nothing personal,
 * so a lost card tells the finder nothing. The database keeps only the SHA-256 of the code; class
 * phones get those hashes with the class list, so a scan works offline too.
 */
export const PICKUP_QR_PREFIX = "YANMU-PICKUP:";

/** The code inside a card's QR, or null if the QR is not one of ours. */
export function parsePickupQr(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith(PICKUP_QR_PREFIX)) return null;
  const code = t.slice(PICKUP_QR_PREFIX.length);
  return /^[A-Za-z0-9_-]{22,64}$/.test(code) ? code : null;
}

export function pickupQrText(code: string): string {
  return PICKUP_QR_PREFIX + code;
}

/** SHA-256 as lowercase hex, the same in the browser and on the server. */
export async function hashPickupCode(code: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 128 random bits, URL-safe. */
export function newPickupCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
