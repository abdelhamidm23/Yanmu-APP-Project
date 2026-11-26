/**
 * The words of a push or SMS (rule 9): the kind of alert and the branch only, never a name or a
 * health detail. Written here in both languages so the alert job needs no request context.
 */
export const ALERT_KEYS = [
  "critical_incident",
  "incident",
  "ratio_breach",
  "still_checked_in",
  "cash_variance",
  "expense_approval",
  "daily_close_missing",
  "daily_close_prompt",
  "issue_assigned",
  "action_assigned",
] as const;
export type AlertKey = (typeof ALERT_KEYS)[number];

const TITLES: Record<AlertKey, { ar: string; en: string }> = {
  critical_incident: { ar: "حادث حرج في {branch}", en: "Critical incident at {branch}" },
  incident: { ar: "حادث جديد في {branch}", en: "New incident at {branch}" },
  ratio_breach: { ar: "عدد المشرفات أقل من المطلوب في {branch}", en: "Not enough carers in a class at {branch}" },
  still_checked_in: { ar: "أطفال ما زالوا في {branch} بعد المواعيد", en: "Children still in at {branch} after hours" },
  cash_variance: { ar: "فرق في الخزنة في {branch}", en: "Cash box difference at {branch}" },
  expense_approval: { ar: "مصروف ينتظر موافقتك في {branch}", en: "An expense waits for approval at {branch}" },
  daily_close_missing: { ar: "{branch} لم يُغلق اليوم بعد", en: "{branch} has not closed the day" },
  daily_close_prompt: { ar: "حان وقت إغلاق اليوم في {branch}", en: "Time to close the day at {branch}" },
  issue_assigned: { ar: "مشكلة جديدة مسندة إليك في {branch}", en: "An issue was assigned to you at {branch}" },
  action_assigned: { ar: "إجراء جديد مسند إليك في {branch}", en: "An action was assigned to you at {branch}" },
};

const OPEN_APP = { ar: "افتح التطبيق للتفاصيل.", en: "Open the app for details." };

export function alertText(key: string, locale: string, branch: { ar: string; en: string }) {
  const loc = locale === "en" ? "en" : "ar";
  const t = TITLES[key as AlertKey] ?? { ar: "تنبيه جديد في {branch}", en: "New alert at {branch}" };
  return { title: t[loc].replace("{branch}", branch[loc]), body: OPEN_APP[loc] };
}
