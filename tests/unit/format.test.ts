import { describe, expect, it } from "vitest";
import { formatNumber, formatPiastres, parseEgpToPiastres } from "@/lib/format";

describe("money is integer piastres", () => {
  it("parses EGP strings without floating point", () => {
    expect(parseEgpToPiastres("500")).toBe(50000n);
    expect(parseEgpToPiastres("20,000")).toBe(2000000n);
    expect(parseEgpToPiastres("0.1")).toBe(10n);
    expect(parseEgpToPiastres("0.29")).toBe(29n); // 0.29 * 100 = 28.999… in floats
    expect(parseEgpToPiastres("-12.5")).toBe(-1250n);
  });

  it("rejects malformed amounts", () => {
    expect(() => parseEgpToPiastres("12.345")).toThrow();
    expect(() => parseEgpToPiastres("abc")).toThrow();
    expect(() => parseEgpToPiastres("")).toThrow();
  });

  it("formats piastres in English with Latin digits", () => {
    expect(formatPiastres(66340000n, "en", "latin")).toBe("663,400");
    expect(formatPiastres(1234550n, "en", "latin")).toBe("12,345.50");
    expect(formatPiastres(-1530000n, "en", "latin")).toBe("−15,300");
  });

  it("formats piastres in Arabic with Arabic-Indic digits", () => {
    expect(formatPiastres(50000n, "ar", "arabic")).toBe("٥٠٠");
    expect(formatPiastres(1234550n, "ar", "arabic")).toMatch(/^١٢.٣٤٥٫٥٠$/);
  });

  it("handles amounts beyond Number.MAX_SAFE_INTEGER exactly", () => {
    expect(formatPiastres(900719925474099312n, "en", "latin")).toBe("9,007,199,254,740,993.12");
  });
});

describe("digit preference", () => {
  it("uses Latin or Arabic-Indic digits per user choice", () => {
    expect(formatNumber(153, "ar", "latin")).toBe("153");
    expect(formatNumber(153, "ar", "arabic")).toBe("١٥٣");
    expect(formatNumber(153, "en", "latin")).toBe("153");
  });
});
