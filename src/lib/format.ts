/**
 * Number, money and date formatting.
 * Money is always integer piastres (EGP × 100) as bigint — never floats (CLAUDE.md rule 5).
 * Times are stored in UTC and shown in Africa/Cairo (rule 11).
 */
export type Locale = "ar" | "en";
export type Digits = "arabic" | "latin";

export const DISPLAY_TIME_ZONE = "Africa/Cairo";

function intlLocale(locale: Locale, digits: Digits): string {
  const base = locale === "ar" ? "ar-EG" : "en-EG";
  return `${base}-u-nu-${digits === "arabic" ? "arab" : "latn"}`;
}

export function formatNumber(value: number | bigint, locale: Locale, digits: Digits): string {
  return new Intl.NumberFormat(intlLocale(locale, digits), { maximumFractionDigits: 0 }).format(value);
}

/** Converts a user-typed EGP amount (string) to piastres without floating point. */
export function parseEgpToPiastres(input: string): bigint {
  const cleaned = input.trim().replace(/[,\s]/g, "");
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new Error(`Not a valid EGP amount: "${input}"`);
  const [, sign, pounds, fraction = ""] = match;
  const piastres = BigInt(pounds) * 100n + BigInt(fraction.padEnd(2, "0"));
  return sign ? -piastres : piastres;
}

/** Formats piastres as EGP, e.g. 1234550n → "12,345.50". The "EGP" unit is shown separately in the UI. */
export function formatPiastres(piastres: bigint, locale: Locale, digits: Digits): string {
  const negative = piastres < 0n;
  const abs = negative ? -piastres : piastres;
  const pounds = abs / 100n;
  const rest = abs % 100n;
  const nf = new Intl.NumberFormat(intlLocale(locale, digits), { useGrouping: true });
  const fractionDigits = new Intl.NumberFormat(intlLocale(locale, digits), {
    minimumIntegerDigits: 2,
    useGrouping: false,
  }).format(Number(rest));
  const decimalSeparator = locale === "ar" && digits === "arabic" ? "٫" : ".";
  const body = rest === 0n ? nf.format(pounds) : `${nf.format(pounds)}${decimalSeparator}${fractionDigits}`;
  return negative ? `−${body}` : body;
}

export function formatDateTime(date: Date, locale: Locale, digits: Digits): string {
  return new Intl.DateTimeFormat(intlLocale(locale, digits), {
    timeZone: DISPLAY_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** A plain calendar date ("2026-11-20") shown in the user's language, e.g. "Fri 20 Nov 2026". */
export function formatPlainDate(isoDate: string, locale: Locale, digits: Digits): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(intlLocale(locale, digits), {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** A moment shown in Cairo time with date and time, e.g. "20 Nov 2026, 14:05". */
export function formatTimestamp(date: Date, locale: Locale, digits: Digits): string {
  return new Intl.DateTimeFormat(intlLocale(locale, digits), {
    timeZone: DISPLAY_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/**
 * Short money for dashboard tiles (spec §11.2): 663,400 EGP → "663.4K" / "٦٦٣٫٤ ألف". Integer arithmetic only
 * (rule 5); the rounded figure is passed to Intl as a decimal string, never through a float.
 */
export function formatPiastresCompact(piastres: bigint, locale: Locale, digits: Digits): string {
  const negative = piastres < 0n;
  const abs = negative ? -piastres : piastres;
  const nf = (s: string, frac: number) =>
    new Intl.NumberFormat(intlLocale(locale, digits), { minimumFractionDigits: frac, maximumFractionDigits: frac, useGrouping: true }).format(
      s as unknown as number,
    );
  let body: string;
  if (abs < 100_000n) {
    // Under EGP 1,000: whole pounds.
    body = nf(((abs + 50n) / 100n).toString(), 0);
  } else if (abs < 99_995_000n) {
    const tenths = (abs + 5_000n) / 10_000n; // tenths of a thousand pounds
    body = `${nf(`${tenths / 10n}.${tenths % 10n}`, 1)}${locale === "ar" ? " ألف" : "K"}`;
  } else {
    const tenths = (abs + 5_000_000n) / 10_000_000n; // tenths of a million pounds
    body = `${nf(`${tenths / 10n}.${tenths % 10n}`, 1)}${locale === "ar" ? " مليون" : "M"}`;
  }
  return negative ? `−${body}` : body;
}
