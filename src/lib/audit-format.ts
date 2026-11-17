import "server-only";
import { isRole } from "./roles";
import type { FieldChange } from "./audit-diff";

type T = (key: string) => string;

/**
 * Makes an audit change readable: "Role: Teacher" instead of "role: teacher",
 * branch names instead of ids, Yes/No instead of true/false.
 */
export function auditFormatter(t: T, has: (key: string) => boolean, names: ReadonlyMap<string, string>) {
  const value = (field: string, v: string | undefined) => {
    if (v === undefined) return undefined;
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
