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
