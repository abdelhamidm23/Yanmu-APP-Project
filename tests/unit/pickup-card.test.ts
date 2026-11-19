import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PICKUP_QR_PREFIX, hashPickupCode, newPickupCode, parsePickupQr, pickupQrText } from "@/lib/pickup-card";
import { EMPTY_DAY, applyEvent, stillInAlertTime } from "@/lib/attendance";
import { SETTINGS } from "@/lib/settings";

describe("QR pickup cards", () => {
  it("makes random URL-safe codes of 128 bits", () => {
    const a = newPickupCode();
    const b = newPickupCode();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
  });

  it("reads only our own QR codes", () => {
    const code = newPickupCode();
    expect(parsePickupQr(pickupQrText(code))).toBe(code);
    expect(parsePickupQr(`  ${pickupQrText(code)}\n`)).toBe(code);
    expect(parsePickupQr("https://example.com")).toBeNull();
    expect(parsePickupQr(`${PICKUP_QR_PREFIX}short`)).toBeNull();
    expect(parsePickupQr(`${PICKUP_QR_PREFIX}${code}<script>`)).toBeNull();
  });

  it("hashes the code with SHA-256, the same as the server", async () => {
    const code = newPickupCode();
    expect(await hashPickupCode(code)).toBe(createHash("sha256").update(code).digest("hex"));
  });

  it("records a QR check-out as such, and a list check-out as the list", () => {
    const present = { ...EMPTY_DAY, status: "present" as const, checkInAt: "2026-11-18T06:00:00.000Z", clientAt: "2026-11-18T06:00:00.000Z" };
    const base = { kind: "checkout" as const, clientUuid: "00000000-0000-4000-8000-000000000001", at: "2026-11-18T13:00:00.000Z", studentId: "00000000-0000-4000-8000-0000000000aa", date: "2026-11-18", guardianId: "00000000-0000-4000-8000-0000000000bb" };
    const qr = applyEvent(present, { ...base, via: "qr" });
    const list = applyEvent(present, base);
    expect("day" in qr && qr.day.checkOutVia).toBe("qr");
    expect("day" in list && list.day.checkOutVia).toBe("list");
  });
});

describe("opening hours (owner's review)", () => {
  it("defaults to 08:00 to 16:00 with a 60-minute after-school time", () => {
    const get = (key: string) => SETTINGS.find((s) => s.key === key)?.default;
    expect(get("attendance.opening_time")).toBe("08:00");
    expect(get("attendance.closing_time")).toBe("16:00");
    expect(get("attendance.after_school_minutes")).toBe(60);
    expect(get("calendar.working_days")).toEqual(["sun", "mon", "tue", "wed", "thu"]);
  });

  it("alerts about children still in once the after-school time has ended", () => {
    expect(stillInAlertTime("16:00", 60)).toBe("17:00");
    expect(stillInAlertTime("16:00", 0)).toBe("16:00");
    expect(stillInAlertTime("15:30", 45)).toBe("16:15");
    expect(stillInAlertTime("23:30", 120)).toBe("23:59");
  });
});
