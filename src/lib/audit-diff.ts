/** Turns an audit row's before/after into a short list of field changes for people to read. */
const HIDDEN = new Set(["id", "org_id", "created_at", "created_by", "updated_at", "updated_by"]);
const SUMMARY = ["name_en", "name_ar", "full_name", "full_name_en", "student_no", "display_name", "account_no", "student_name", "name", "code", "key", "date", "role", "user_id", "branch_id", "email", "type", "status", "purpose", "start_date", "file_name", "note"];

export interface FieldChange {
  field: string;
  from?: string;
  to?: string;
}

function show(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export function auditChanges(action: string, before: unknown, after: unknown): FieldChange[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  if (action === "update") {
    return Object.keys({ ...b, ...a })
      .filter((k) => !HIDDEN.has(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]))
      .map((k) => ({ field: k, from: show(b[k]), to: show(a[k]) }));
  }
  const row = action === "delete" ? b : a;
  return SUMMARY.filter((k) => k in row && row[k] !== null).map((k) => ({ field: k, to: show(row[k]) }));
}
