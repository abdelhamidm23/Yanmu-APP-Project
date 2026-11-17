import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { organization, setting } from "./schema";
import type { Tx } from "./rls";
import { settingDef } from "@/lib/settings";

/** Organization-wide settings as a map (key → value), defaults filled in. */
export async function readOrgSettings(tx: Tx): Promise<Map<string, unknown>> {
  const rows = await tx.select({ key: setting.key, value: setting.value }).from(setting).where(isNull(setting.branchId));
  return new Map(rows.map((r) => [r.key, r.value]));
}

/** Validates and saves one organization-wide setting. The audit trigger records the change. */
export async function writeOrgSetting(tx: Tx, key: string, value: unknown) {
  const parsed = settingDef(key).schema.parse(value);
  const json = sql`${JSON.stringify(parsed)}::jsonb`;
  const updated = await tx
    .update(setting)
    .set({ value: json })
    .where(and(eq(setting.key, key), isNull(setting.branchId)))
    .returning({ id: setting.id });
  if (updated.length === 0) {
    const [org] = await tx.select({ id: organization.id }).from(organization).limit(1);
    await tx.insert(setting).values({ orgId: org.id, branchId: null, key, value: json });
  }
}
