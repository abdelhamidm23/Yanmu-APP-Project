/** Tables with the audit trigger (drizzle/0002). Keep in step with the migration. */
export const AUDITED_TABLES = [
  "organization",
  "branch",
  "age_band",
  "room",
  "academic_year",
  "term",
  "calendar_day",
  "setting",
  "user_branch_role",
  "app_user",
] as const;
