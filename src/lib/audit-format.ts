import "server-only";
import { isRole } from "./roles";
import type { FieldChange } from "./audit-diff";

type T = (key: string) => string;

/**
 * Makes an audit change readable: "Role: Teacher" instead of "role: teacher",
 * branch names instead of ids, Yes/No instead of true/false.
 */
/** Medical text is stored in the audit log only as a fingerprint (drizzle/0004); never show it. */
const PRIVATE_FIELDS = new Set(["allergies", "conditions", "medications", "doctor_contact"]);

export function auditFormatter(t: T, has: (key: string) => boolean, names: ReadonlyMap<string, string>) {
  const value = (field: string, v: string | undefined) => {
    if (v === undefined) return undefined;
    if (PRIVATE_FIELDS.has(field)) return t("settings.audit.hidden");
    if (v === "true") return t("settings.common.yes");
    if (v === "false") return t("settings.common.no");
    if (field === "role" && isRole(v)) return t(`roles.${v}`);
    if (field === "key" && has(`settings.values.keys.${v}`)) return t(`settings.values.keys.${v}`);
    return names.get(v) ?? v;
  };
  return (c: FieldChange) => ({
    field: has(`settings.audit.fields.${c.field}`) ? t(`settings.audit.fields.${c.field}`) : c.field,
    from: value(c.field, c.from),
    to: value(c.field, c.to),
  });
}
