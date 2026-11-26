/**
 * Every adjustable threshold from docs/SPEC.md §17.3, with its default and validation.
 * Stored in the `setting` table (jsonb). Organization-wide unless a branch row overrides it.
 * Capacities (licensed 100 / physical 200) live on each branch row instead.
 */
import { z } from "zod";

const piastres = z.number().int().min(0);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type SettingKind = "integer" | "piastres" | "egp-nullable" | "decimal" | "time" | "weekdays" | "choice" | "minutes";

interface SettingDef<T> {
  key: string;
  group: "billing" | "calendar" | "approvals" | "capacity" | "operations" | "alerts";
  kind: SettingKind;
  schema: z.ZodType<T>;
  default: T;
  choices?: readonly string[];
}

function def<T>(d: SettingDef<T>) {
  return d;
}

export const SETTINGS = [
  def({ key: "billing.invoice_day", group: "billing", kind: "integer", schema: z.number().int().min(1).max(28), default: 1 }),
  def({ key: "billing.due_day", group: "billing", kind: "integer", schema: z.number().int().min(1).max(28), default: 5 }),
  def({ key: "billing.prorate_new_starts", group: "billing", kind: "choice", schema: z.enum(["on", "off"]), default: "on", choices: ["on", "off"] }),
  def({ key: "billing.preview_until", group: "billing", kind: "time", schema: time, default: "09:00" }),
  def({ key: "late_fee.daily_piastres", group: "billing", kind: "piastres", schema: piastres, default: 50000 }),
  def({ key: "late_fee.basis", group: "billing", kind: "choice", schema: z.enum(["per_invoice", "per_family"]), default: "per_invoice", choices: ["per_invoice", "per_family"] }),
  def({ key: "late_fee.cap_piastres", group: "billing", kind: "egp-nullable", schema: piastres.nullable(), default: null }),
  def({ key: "calendar.working_days", group: "calendar", kind: "weekdays", schema: z.array(z.enum(WEEKDAYS)).min(1), default: ["sun", "mon", "tue", "wed", "thu"] as Weekday[] }),
  def({ key: "approvals.branch_manager_limit_piastres", group: "approvals", kind: "piastres", schema: piastres, default: 2000000 }),
  def({ key: "approvals.unusual_multiplier", group: "approvals", kind: "decimal", schema: z.number().min(1).max(10), default: 2.0 }),
  def({ key: "expenses.photo_required_from_piastres", group: "approvals", kind: "piastres", schema: piastres, default: 10000 }),
  def({ key: "age_band.move_up_notice_days", group: "capacity", kind: "integer", schema: z.number().int().min(0).max(365), default: 30 }),
  def({ key: "age_band.leaving_notice_days", group: "capacity", kind: "integer", schema: z.number().int().min(0).max(365), default: 60 }),
  def({ key: "ratio.snapshot_time", group: "operations", kind: "time", schema: time, default: "10:00" }),
  def({ key: "attendance.opening_time", group: "operations", kind: "time", schema: time, default: "08:00" }),
  def({ key: "attendance.closing_time", group: "operations", kind: "time", schema: time, default: "16:00" }),
  def({ key: "attendance.after_school_minutes", group: "operations", kind: "minutes", schema: z.number().int().min(0).max(240), default: 60 }),
  def({ key: "staff_attendance.grace_minutes", group: "operations", kind: "minutes", schema: z.number().int().min(0).max(120), default: 10 }),
  def({ key: "daily_close.prompt_time", group: "operations", kind: "time", schema: time, default: "17:00" }),
  def({ key: "daily_close.due_time", group: "operations", kind: "time", schema: time, default: "19:00" }),
  def({ key: "daily_close.alert_time", group: "operations", kind: "time", schema: time, default: "21:00" }),
  def({ key: "cash.variance_alert_piastres", group: "operations", kind: "piastres", schema: piastres, default: 20000 }),
  def({ key: "alerts.critical_repeat_minutes", group: "alerts", kind: "minutes", schema: z.number().int().min(1).max(60), default: 5 }),
  def({ key: "alerts.step_to_company_manager_minutes", group: "alerts", kind: "minutes", schema: z.number().int().min(1), default: 30 }),
  def({ key: "alerts.step_to_owner_minutes", group: "alerts", kind: "minutes", schema: z.number().int().min(1), default: 120 }),
  def({ key: "alerts.quiet_hours_start", group: "alerts", kind: "time", schema: time, default: "22:00" }),
  def({ key: "alerts.quiet_hours_end", group: "alerts", kind: "time", schema: time, default: "07:00" }),
  def({ key: "attention.overdue_days", group: "alerts", kind: "integer", schema: z.number().int().min(1), default: 60 }),
  def({ key: "attention.overdue_amount_piastres", group: "alerts", kind: "piastres", schema: piastres, default: 1500000 }),
  // Home, "Requires your attention" (spec §9.6 items 5 and 6).
  def({ key: "attention.expense_rise_percent", group: "alerts", kind: "integer", schema: z.number().int().min(1).max(1000), default: 20 }),
  def({ key: "attention.occupancy_drop_points", group: "alerts", kind: "integer", schema: z.number().int().min(1).max(100), default: 5 }),
] as const;

export type SettingKey = (typeof SETTINGS)[number]["key"];
export const SETTING_GROUPS = ["billing", "calendar", "approvals", "capacity", "operations", "alerts"] as const;

export function settingDef(key: string) {
  const d = SETTINGS.find((s) => s.key === key);
  if (!d) throw new Error(`Unknown setting: ${key}`);
  return d as SettingDef<unknown>;
}

/** Turns what was typed in the settings form into the stored value, or throws a ZodError. */
export function parseSettingInput(key: string, raw: string | string[]): unknown {
  const d = settingDef(key);
  const text = Array.isArray(raw) ? raw : raw.trim();
  let value: unknown;
  switch (d.kind) {
    case "weekdays":
      value = Array.isArray(text) ? text : text ? [text] : [];
      break;
    case "piastres":
      value = egpToPiastresNumber(String(text));
      break;
    case "egp-nullable":
      value = String(text) === "" ? null : egpToPiastresNumber(String(text));
      break;
    case "integer":
    case "minutes":
      value = /^-?\d+$/.test(String(text)) ? Number(text) : NaN;
      break;
    case "decimal":
      value = /^\d+(\.\d+)?$/.test(String(text)) ? Number(text) : NaN;
      break;
    default:
      value = text;
  }
  return d.schema.parse(value);
}

function egpToPiastresNumber(text: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.replace(/[,\s]/g, ""));
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
