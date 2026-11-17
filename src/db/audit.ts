import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { academicYear, ageBand, appUser, auditEvent, branch } from "./schema";
import type { Tx } from "./rls";

export const AUDIT_PAGE_SIZE = 50;

/** Reads the audit log newest first. RLS limits it to org admins. `before` is the cursor from the previous page. */
export async function readAudit(tx: Tx, opts: { table?: string; before?: string; limit?: number }) {
  const where: SQL[] = [];
  if (opts.table) where.push(eq(auditEvent.tableName, opts.table));
  if (opts.before) {
    const [at, id] = opts.before.split("_");
    where.push(sql`(${auditEvent.at}, ${auditEvent.id}) < (${at}::timestamp at time zone 'UTC', ${id}::uuid)`);
  }
  const limit = opts.limit ?? AUDIT_PAGE_SIZE;
  const rows = await tx
    .select({
      id: auditEvent.id,
      at: auditEvent.at,
      cursorAt: sql<string>`(${auditEvent.at} at time zone 'UTC')::text`,
      actorName: appUser.name,
      actorUserId: auditEvent.actorUserId,
      tableName: auditEvent.tableName,
      action: auditEvent.action,
      before: auditEvent.before,
      after: auditEvent.after,
      reason: auditEvent.reason,
    })
    .from(auditEvent)
    .leftJoin(appUser, eq(appUser.id, auditEvent.actorUserId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditEvent.at), desc(auditEvent.id))
    .limit(limit + 1);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { rows: page, next: more && last ? `${last.cursorAt}_${last.id}` : null };
}

export { AUDITED_TABLES } from "./audit-tables";

/** id → readable name for branches, age bands, users and academic years, for showing audit changes. */
export async function auditNames(tx: Tx, locale: "ar" | "en") {
  const [branches, bands, users, years] = await Promise.all([
    tx.select({ id: branch.id, ar: branch.nameAr, en: branch.nameEn }).from(branch),
    tx.select({ id: ageBand.id, ar: ageBand.nameAr, en: ageBand.nameEn }).from(ageBand),
    tx.select({ id: appUser.id, name: appUser.name }).from(appUser),
    tx.select({ id: academicYear.id, label: academicYear.label }).from(academicYear),
  ]);
  return new Map<string, string>([
    ...branches.map((b) => [b.id, locale === "ar" ? b.ar : b.en] as [string, string]),
    ...bands.map((b) => [b.id, locale === "ar" ? b.ar : b.en] as [string, string]),
    ...users.map((u) => [u.id, u.name] as [string, string]),
    ...years.map((y) => [y.id, y.label] as [string, string]),
  ]);
}
