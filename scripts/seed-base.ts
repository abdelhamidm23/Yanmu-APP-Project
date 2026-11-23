/**
 * Creates the organization, the four age bands (spec §2.1), two branches and every
 * setting default (spec §17.3). Safe to run again: it only adds what is missing.
 *
 * Branches are Yanmu (code A) and Norvale (code B), named by the owner on 2026-11-18. Names can be changed in Settings.
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

// Arabic labels are editable in Settings (spec §2.1 note). Owner, 2026-11-22: write the English
// names in Arabic letters (جونيورز), not translations. oldAr is the earlier suggested label, which is
// replaced only if nobody has changed it since.
const bands = [
  { key: "babies", nameAr: "بيبيز", oldAr: "الرُّضّع", nameEn: "Babies", minAgeMonths: 3, maxAgeMonths: 12, childrenPerStaff: 3, sort: 1 },
  { key: "toddlers", nameAr: "تودلرز", oldAr: "الدارجون", nameEn: "Toddlers", minAgeMonths: 12, maxAgeMonths: 24, childrenPerStaff: 4, sort: 2 },
  { key: "juniors", nameAr: "جونيورز", oldAr: "البراعم", nameEn: "Juniors", minAgeMonths: 24, maxAgeMonths: 36, childrenPerStaff: 6, sort: 3 },
  { key: "seniors", nameAr: "سينيورز", oldAr: "الكبار", nameEn: "Seniors", minAgeMonths: 36, maxAgeMonths: 54, childrenPerStaff: 6, sort: 4 },
];
for (const { oldAr, ...b } of bands) {
  await db.insert(schema.ageBand).values({ orgId: org.id, ...b }).onConflictDoNothing();
  await db
    .update(schema.ageBand)
    .set({ nameAr: b.nameAr })
    .where(and(eq(schema.ageBand.orgId, org.id), eq(schema.ageBand.key, b.key), eq(schema.ageBand.nameAr, oldAr)));
}

const branches = [
  { code: "A", nameAr: "يانمو", nameEn: "Yanmu" },
  { code: "B", nameAr: "نورفال", nameEn: "Norvale" },
];
for (const b of branches) {
  await db.insert(schema.branch).values({ orgId: org.id, ...b }).onConflictDoNothing();
  // Databases seeded before the owner chose the names still say "Branch A" / "Branch B".
  await db
    .update(schema.branch)
    .set({ nameAr: b.nameAr, nameEn: b.nameEn })
    .where(and(eq(schema.branch.orgId, org.id), eq(schema.branch.code, b.code), eq(schema.branch.nameEn, `Branch ${b.code}`)));
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

// Expense categories (spec §8.10, aligned with the owner's workbooks). Routine by default (A2):
// food and kitchen, cleaning and hygiene, consumables, learning materials, utilities, small repairs.
const CATEGORIES: [string, string, string, boolean][] = [
  ["salaries", "الرواتب والمزايا", "Salaries & benefits", false],
  ["security", "الأمن", "Security", false],
  ["marketing", "التسويق", "Marketing", false],
  ["rent", "الإيجار", "Rent", false],
  ["utilities", "المرافق (كهرباء ومياه وغاز)", "Utilities", true],
  ["food", "الطعام والمطبخ", "Food & kitchen", true],
  ["cleaning", "النظافة والتعقيم", "Cleaning & hygiene", true],
  ["consumables", "المستهلكات", "Consumables", true],
  ["learning", "الأدوات التعليمية", "Learning materials", true],
  ["maintenance", "الصيانة والإصلاحات", "Maintenance & repairs", true],
  ["transport", "المواصلات", "Transportation", false],
  ["admin", "مصروفات إدارية", "Administrative", false],
  ["other", "أخرى", "Other", false],
];
for (const [i, [key, nameAr, nameEn, routine]] of CATEGORIES.entries()) {
  await db.insert(schema.expenseCategory).values({ orgId: org.id, key, nameAr, nameEn, isRoutineDefault: routine, sort: i + 1 }).onConflictDoNothing();
}
// A branch with no routine list yet gets the default one.
const cats = await db.select().from(schema.expenseCategory).where(eq(schema.expenseCategory.orgId, org.id));
for (const b of await db.select().from(schema.branch).where(eq(schema.branch.orgId, org.id))) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.branchRoutineCategory).where(eq(schema.branchRoutineCategory.branchId, b.id));
  if (n > 0) continue;
  for (const c of cats.filter((x) => x.isRoutineDefault)) {
    await db.insert(schema.branchRoutineCategory).values({ branchId: b.id, categoryId: c.id }).onConflictDoNothing();
  }
}

console.log("Organization, age bands, branches, expense categories and default settings are ready.");
await client.end();
