import { WEEKDAYS, type Weekday } from "./settings";

/** Weekday key of a calendar date ("2026-11-20" → "fri"). Dates are plain dates, no time zone. */
export function weekdayOf(isoDate: string): Weekday {
  const [y, m, d] = isoDate.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * Same rule as SQL is_working_day(): an explicit calendar_day row wins,
 * otherwise the weekly pattern (spec W1, default Sunday–Thursday).
 */
export function isWorkingDay(isoDate: string, weeklyPattern: readonly Weekday[], exceptions: ReadonlyMap<string, boolean>): boolean {
  const exception = exceptions.get(isoDate);
  if (exception !== undefined) return exception;
  return weeklyPattern.includes(weekdayOf(isoDate));
}

/** Today's date in Cairo as YYYY-MM-DD (rule 11). */
export function todayInCairo(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(now);
}

/** Minutes Cairo is ahead of UTC at this instant (120, or 180 in summer time). */
export function cairoOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** A Cairo wall-clock time (as the fingerprint device writes it) → the real instant (rule 11). */
export function cairoWallToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = wall - cairoOffsetMinutes(new Date(wall)) * 60000;
  // Second pass settles the hour around the summer-time switch.
  utc = wall - cairoOffsetMinutes(new Date(utc)) * 60000;
  return new Date(utc);
}

/** "HH:MM" of an instant in Cairo. */
export function cairoTimeOf(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** Minutes since midnight of "HH:MM". */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
