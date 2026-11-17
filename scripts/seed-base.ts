/**
 * Creates the organization, the four age bands (spec §2.1), two branches and every
 * setting default (spec §17.3). Safe to run again: it only adds what is missing.
 *
 * Branch names are placeholders ("Branch A" / "Branch B") until the owner renames them in Settings.
 * Usage: pnpm seed:base
 */
import "dotenv/config";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { SETTINGS } from "../src/lib/settings";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");
const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });

let [org] = await db.select().from(schema.organization).limit(1);
if (!org) {
  [org] = await db
    .insert(schema.organization)
    .values({ nameAr: "مجموعة وليد إبراهيم", nameEn: "Walid Ibrahim Group" })
    .returning();
}

// Arabic labels are the spec's suggestions and editable in Settings (spec §2.1 note).
const bands = [
  { key: "babies", nameAr: "الرُّضّع", nameEn: "Babies", minAgeMonths: 3, maxAgeMonths: 12, childrenPerStaff: 3, sort: 1 },
  { key: "toddlers", nameAr: "الدارجون", nameEn: "Toddlers", minAgeMonths: 12, maxAgeMonths: 24, childrenPerStaff: 4, sort: 2 },
  { key: "juniors", nameAr: "البراعم", nameEn: "Juniors", minAgeMonths: 24, maxAgeMonths: 36, childrenPerStaff: 6, sort: 3 },
  { key: "seniors", nameAr: "الكبار", nameEn: "Seniors", minAgeMonths: 36, maxAgeMonths: 54, childrenPerStaff: 6, sort: 4 },
];
for (const b of bands) {
  await db.insert(schema.ageBand).values({ orgId: org.id, ...b }).onConflictDoNothing();
}

const branches = [
  { code: "A", nameAr: "الفرع أ", nameEn: "Branch A" },
  { code: "B", nameAr: "الفرع ب", nameEn: "Branch B" },
];
for (const b of branches) {
  await db.insert(schema.branch).values({ orgId: org.id, ...b }).onConflictDoNothing();
}

for (const s of SETTINGS) {
  const existing = await db
    .select({ id: schema.setting.id })
    .from(schema.setting)
    .where(and(eq(schema.setting.orgId, org.id), isNull(schema.setting.branchId), eq(schema.setting.key, s.key)));
  if (existing.length === 0) {
    await db.insert(schema.setting).values({ orgId: org.id, branchId: null, key: s.key, value: sql`${JSON.stringify(s.default)}::jsonb` });
  }
}

console.log("Organization, age bands, branches and default settings are ready.");
await client.end();
