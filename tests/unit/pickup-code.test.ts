import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CODE_LENGTH, PICKUP_QR_PREFIX, dailyPickupCode, formatPickupCode, matchPickupCode, pickupQrText, readPickupInput } from "@/lib/pickup-code";
import { hashPickupLinkSecret, isPickupLinkSecret, newPickupLinkSecret } from "@/lib/pickup-card";
import { EMPTY_DAY, applyEvent, stillInAlertTime } from "@/lib/attendance";
import { SETTINGS } from "@/lib/settings";

const KEY = "test-secret-for-pickup-codes";
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";

describe("daily pickup codes", () => {
  it("gives each child one fixed code per day, and a new one the next day", () => {
    const today = dailyPickupCode(A, "2026-11-19", 0, KEY);
    expect(today).toMatch(new RegExp(`^[0-9A-HJKMNP-TV-Z]{${CODE_LENGTH}}$`));
    expect(dailyPickupCode(A, "2026-11-19", 0, KEY)).toBe(today);
    expect(dailyPickupCode(A, "2026-11-20", 0, KEY)).not.toBe(today);
    expect(dailyPickupCode(B, "2026-11-19", 0, KEY)).not.toBe(today);
    expect(dailyPickupCode(A, "2026-11-19", 1, KEY)).not.toBe(today);
    expect(dailyPickupCode(A, "2026-11-19", 0, "another-secret")).not.toBe(today);
  });

  it("puts only the code in the QR: no name or number", () => {
    const code = dailyPickupCode(A, "2026-11-19", 0, KEY);
    expect(pickupQrText(code)).toBe(`${PICKUP_QR_PREFIX}${code}`);
    expect(pickupQrText(code)).not.toContain(A);
  });

  it("reads a scanned QR or a typed code, forgiving spaces, dashes, case and O/I/L", () => {
    const code = "K7QD3XPA9M";
    expect(readPickupInput(pickupQrText(code))).toBe(code);
    expect(readPickupInput(` ${formatPickupCode(code)} `)).toBe(code);
    expect(formatPickupCode(code)).toBe("K7QD3-XPA9M");
    expect(readPickupInput("k7qd3 xpa9m")).toBe(code);
    expect(readPickupInput("1O1O1-IL0O0")).toBe("1010111000");
    expect(readPickupInput("https://example.com")).toBeNull();
    expect(readPickupInput("SHORT")).toBeNull();
    expect(readPickupInput("K7QD3XPA9U")).toBeNull();
    expect(readPickupInput(`${PICKUP_QR_PREFIX}K7QD3XPA9M<script>`)).toBeNull();
  });

  it("matches today's code, and calls yesterday's or a replaced code old", () => {
    const kids = [
      { id: A, pickupCodeVersion: 1 },
      { id: B, pickupCodeVersion: 0 },
    ];
    const m = (code: string) => matchPickupCode(code, kids, "2026-11-19", "2026-11-18", KEY);
    expect(m(dailyPickupCode(A, "2026-11-19", 1, KEY))).toMatchObject({ child: { id: A }, when: "today" });
    expect(m(dailyPickupCode(B, "2026-11-19", 0, KEY))).toMatchObject({ child: { id: B }, when: "today" });
    expect(m(dailyPickupCode(A, "2026-11-19", 0, KEY))).toMatchObject({ child: { id: A }, when: "old" });
    expect(m(dailyPickupCode(B, "2026-11-18", 0, KEY))).toMatchObject({ child: { id: B }, when: "old" });
    expect(m(dailyPickupCode(B, "2026-11-17", 0, KEY))).toBeNull();
    expect(m("0000000000")).toBeNull();
  });
});

describe("private pickup links", () => {
  it("are random, URL-safe, 128 bits, and stored only as a SHA-256", () => {
    const a = newPickupLinkSecret();
    expect(isPickupLinkSecret(a)).toBe(true);
    expect(a).not.toBe(newPickupLinkSecret());
    expect(hashPickupLinkSecret(a)).toBe(createHash("sha256").update(a).digest("hex"));
    expect(isPickupLinkSecret("../../etc/passwd")).toBe(false);
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
