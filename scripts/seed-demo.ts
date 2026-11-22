/**
 * Demo children for the online preview (spec §16): Yanmu (code A) 92 children in 6 classes, Norvale (B) 61 in 8
 * (the owner's class layout, review of phases 0 to 3),
 * a Yanmu waitlist of 9 (Toddlers 6, Babies 3), staff and today's attendance (seed-demo-attendance.ts).
 * All names are made up and every row is
 * flagged is_demo. `pnpm seed:wipe-demo` removes them again.
 *
 * Refuses to run in production unless DEMO_MODE=true.
 * Usage: pnpm seed:demo            (does nothing if the demo children already match the class layout below;
 *                                   if the layout changed, the demo is rebuilt)
 *        pnpm seed:demo --reset    (removes the demo children first)
 */
import "dotenv/config";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { todayInCairo } from "../src/lib/calendar";
import { addDays, addMonths } from "../src/lib/children";
import { wipeDemo } from "./wipe-demo";
import { seedDemoAttendance } from "./seed-demo-attendance";
import { seedDemoMoney } from "./seed-demo-money";

if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "true") {
  console.error("Refusing to add demo data in production (only allowed when DEMO_MODE=true).");
  process.exit(1);
}
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");
const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });

// Same numbers every run, so the screens can be compared with spec §16.
let seed = 20261118;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const GIRLS: [string, string][] = [
  ["ليلى", "Laila"], ["مريم", "Mariam"], ["فريدة", "Farida"], ["سلمى", "Salma"], ["جنى", "Jana"], ["حبيبة", "Habiba"],
  ["نور", "Nour"], ["ملك", "Malak"], ["رقية", "Ruqaya"], ["تاليا", "Talia"], ["كارما", "Karma"], ["ياسمين", "Yasmin"],
  ["هنا", "Hana"], ["لارا", "Lara"], ["سارة", "Sara"], ["دارين", "Dareen"], ["لينا", "Lina"], ["آسيا", "Asia"],
];
const BOYS: [string, string][] = [
  ["عمر", "Omar"], ["يوسف", "Youssef"], ["آدم", "Adam"], ["مالك", "Malek"], ["حمزة", "Hamza"], ["زياد", "Ziad"],
  ["علي", "Ali"], ["سليم", "Selim"], ["ياسين", "Yassin"], ["تميم", "Tamim"], ["مازن", "Mazen"], ["كريم", "Karim"],
  ["سيف", "Seif"], ["إياد", "Eyad"], ["معاذ", "Moaz"], ["نوح", "Noah"], ["أنس", "Anas"], ["فارس", "Fares"],
];
const FATHERS: [string, string][] = [
  ["أحمد", "Ahmed"], ["محمد", "Mohamed"], ["مصطفى", "Mostafa"], ["خالد", "Khaled"], ["طارق", "Tarek"], ["شريف", "Sherif"],
  ["هشام", "Hesham"], ["عمرو", "Amr"], ["وائل", "Wael"], ["إسلام", "Islam"], ["حسام", "Hossam"], ["كريم", "Karim"],
];
const MOTHERS: [string, string][] = [
  ["منى", "Mona"], ["دينا", "Dina"], ["رانيا", "Rania"], ["هبة", "Heba"], ["نهى", "Noha"], ["ريم", "Reem"],
  ["سمر", "Samar"], ["إيمان", "Eman"], ["شيماء", "Shaimaa"], ["أمل", "Amal"], ["نادين", "Nadine"], ["داليا", "Dalia"],
];
const FAMILIES: [string, string][] = [
  ["حسن", "Hassan"], ["إبراهيم", "Ibrahim"], ["عبد الله", "Abdallah"], ["السيد", "El-Sayed"], ["منصور", "Mansour"], ["فهمي", "Fahmy"],
  ["الشريف", "El-Sherif"], ["رشاد", "Rashad"], ["عثمان", "Osman"], ["صبري", "Sabry"], ["نجيب", "Naguib"], ["زكي", "Zaki"],
  ["عادل", "Adel"], ["فؤاد", "Fouad"], ["سالم", "Salem"], ["كامل", "Kamel"], ["حلمي", "Helmy"], ["شاكر", "Shaker"],
];
const ALLERGIES = ["Peanuts", "Milk", "Eggs", "Penicillin", "Dust"];

// Classes per branch: [band key, English name, Arabic name, capacity, children]
// Owner, 2026-11-22: Arabic class names are the English names written in Arabic letters (جونيورز ٢), not translations.
const PLAN: Record<"A" | "B", [string, string, string, number, number][]> = {
  A: [
    ["babies", "Babies 1", "بيبيز ١", 9, 9],
    ["toddlers", "Toddlers 1", "تودلرز ١", 12, 11],
    ["juniors", "Juniors 1", "جونيورز ١", 22, 20],
    // Owner, 2026-11-22: Yanmu's second toddler class became "Juniors 2".
    ["juniors", "Juniors 2", "جونيورز ٢", 12, 11],
    ["seniors", "Seniors 1", "سينيورز ١", 22, 21],
    ["seniors", "Seniors 2", "سينيورز ٢", 22, 20],
  ],
  B: [
    ["babies", "Babies 1", "بيبيز ١", 9, 6],
    ["toddlers", "Toddlers 1", "تودلرز ١", 12, 12],
    ["toddlers", "Toddlers 2", "تودلرز ٢", 12, 5],
    ["juniors", "Juniors 1", "جونيورز ١", 18, 9],
    ["juniors", "Juniors 2", "جونيورز ٢", 18, 9],
    ["seniors", "Seniors 1", "سينيورز ١", 18, 7],
    ["seniors", "Seniors 2", "سينيورز ٢", 18, 7],
    ["seniors", "Seniors 3", "سينيورز ٣", 18, 6],
  ],
};

const phone = () => `01${pick(["0", "1", "2", "5"])}${String(int(0, 99999999)).padStart(8, "0")}`;
const today = todayInCairo();

/** True when the classes in use and their demo children already match PLAN (so a running demo is left alone). */
async function layoutMatches(): Promise<boolean> {
  const rows = (await db.execute(sql`
    select b.code, r.name_en || '/' || r.name_ar as "name", count(e.id)::int as "n"
    from room r join branch b on b.id = r.branch_id
    left join enrollment e on e.room_id = r.id and e.is_demo and e.status = 'active'
    where r.is_active and b.code in ('A', 'B')
    group by b.code, r.name_en, r.name_ar`)) as unknown as { code: "A" | "B"; name: string; n: number }[];
  const want = (["A", "B"] as const).flatMap((code) => PLAN[code].map(([, nameEn, nameAr, , count]) => `${code}|${nameEn}/${nameAr}|${count}`)).sort();
  const have = rows.map((r) => `${r.code}|${r.name}|${r.n}`).sort();
  return want.length === have.length && want.every((w, i) => w === have[i]);
}

/** Puts the classes of a branch in line with PLAN. Classes left over are removed, or switched off if records point at them. */
async function shapeClasses(branchId: string, code: "A" | "B") {
  const rooms = await db.select().from(schema.room).where(eq(schema.room.branchId, branchId));
  const names = new Set(PLAN[code].map(([, nameEn]) => nameEn));
  for (const r of rooms.filter((x) => !names.has(x.nameEn))) {
    try {
      await db.transaction((tx) => tx.delete(schema.room).where(eq(schema.room.id, r.id)));
    } catch {
      await db.update(schema.room).set({ isActive: false }).where(eq(schema.room.id, r.id));
    }
  }
  for (const [bandKey, nameEn, nameAr, capacity] of PLAN[code]) {
    const r = rooms.find((x) => x.nameEn === nameEn);
    if (r) await db.update(schema.room).set({ nameAr, ageBandId: band(bandKey).id, capacity, isActive: true }).where(eq(schema.room.id, r.id));
  }
}

const bands = await db.select().from(schema.ageBand);
const band = (key: string) => bands.find((b) => b.key === key)!;

const reset = process.argv.includes("--reset") || !(await layoutMatches());
const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.student).where(eq(schema.student.isDemo, true));
if (existing.n > 0 && !reset) {
  console.log(`Demo children already there (${existing.n}). Use --reset to recreate them.`);
  console.log(await seedDemoAttendance(db));
  console.log(await seedDemoMoney(db));
  await client.end();
  process.exit(0);
}
if (existing.n > 0) {
  console.log("The demo class layout changed: rebuilding the demo children, staff and attendance.");
  await wipeDemo(db);
}

const branches = await db.select().from(schema.branch).where(inArray(schema.branch.code, ["A", "B"]));

let total = 0;
for (const code of ["A", "B"] as const) {
  const b = branches.find((x) => x.code === code);
  if (!b) throw new Error(`Branch ${code} not found. Run pnpm seed:base first.`);
  await shapeClasses(b.id, code);
  let familyNo = 0;
  let childNo = 0;
  const [{ maxF }] = (await db.execute(sql`select coalesce(max(substring(account_no from '[0-9]+$')::int), 0) as "maxF" from family where account_no like ${code + "-F%"}`)) as unknown as { maxF: number }[];
  const [{ maxS }] = (await db.execute(sql`select coalesce(max(substring(student_no from '[0-9]+$')::int), 0) as "maxS" from student where student_no ~ ${"^" + code + "-[0-9]+$"}`)) as unknown as { maxS: number }[];
  familyNo = maxF;
  childNo = maxS;

  // Families with a child in an older class sometimes have a younger brother or sister too.
  const openFamilies: { id: string; surname: [string, string]; guardians: string[] }[] = [];
  for (const [bandKey, nameEn, nameAr, capacity, count] of PLAN[code]) {
    const bd = band(bandKey);
    let [room] = await db.select().from(schema.room).where(and(eq(schema.room.branchId, b.id), eq(schema.room.nameEn, nameEn)));
    if (!room) [room] = await db.insert(schema.room).values({ branchId: b.id, nameEn, nameAr, ageBandId: bd.id, capacity }).returning();

    for (let i = 0; i < count; i++) {
      const girl = rand() < 0.5;
      const [firstAr, firstEn] = pick(girl ? GIRLS : BOYS);
      // Age inside the class's band, in days, so some are close to moving up.
      const ageDays = int(bd.minAgeMonths * 30.5 + 5, bd.maxAgeMonths * 30.5 - 3);
      const dob = addDays(today, -ageDays);
      const earliest = addMonths(dob, 3);
      const guess = addDays(today, -int(14, 400));
      const start = guess < earliest ? earliest : guess;

      const sibling = openFamilies.length > 0 && rand() < 0.12 ? openFamilies.splice(int(0, openFamilies.length - 1), 1)[0] : null;
      let familyId: string;
      let surname: [string, string];
      let guardianIds: string[];
      if (sibling) {
        ({ id: familyId, surname, guardians: guardianIds } = sibling);
      } else {
        surname = pick(FAMILIES);
        const [fatherAr] = pick(FATHERS);
        const [motherAr] = pick(MOTHERS);
        familyNo++;
        const [f] = await db
          .insert(schema.family)
          .values({ branchId: b.id, accountNo: `${code}-F${String(familyNo).padStart(4, "0")}`, displayName: `أسرة ${surname[0]}`, isDemo: true })
          .returning({ id: schema.family.id });
        familyId = f.id;
        const gs = await db
          .insert(schema.guardian)
          .values([
            { familyId, branchId: b.id, fullName: `${motherAr} ${pick(FAMILIES)[0]}`, relationship: "mother", phone: phone(), isDemo: true },
            { familyId, branchId: b.id, fullName: `${fatherAr} ${surname[0]}`, relationship: "father", phone: phone(), isDemo: true },
          ])
          .returning({ id: schema.guardian.id });
        guardianIds = gs.map((g) => g.id);
        if (bd.minAgeMonths >= 24) openFamilies.push({ id: familyId, surname, guardians: guardianIds });
      }
      childNo++;
      const fatherFirst = pick(FATHERS);
      const [s] = await db
        .insert(schema.student)
        .values({
          branchId: b.id,
          studentNo: `${code}-${String(childNo).padStart(4, "0")}`,
          fullNameAr: `${firstAr} ${fatherFirst[0]} ${surname[0]}`,
          fullNameEn: `${firstEn} ${fatherFirst[1]} ${surname[1]}`,
          dateOfBirth: dob,
          gender: girl ? "female" : "male",
          familyId,
          status: "pending",
          isDemo: true,
        })
        .returning({ id: schema.student.id });
      for (const [j, gid] of guardianIds.entries()) {
        await db.insert(schema.studentGuardian).values({ studentId: s.id, guardianId: gid, branchId: b.id, canPickUp: true, isPrimaryContact: j === 0 });
      }
      // About one in twenty has no signed records consent yet, so the red flag shows.
      if (rand() > 0.05) {
        await db.insert(schema.consentRecord).values({ studentId: s.id, guardianId: guardianIds[0], branchId: b.id, purpose: "records", grantedOn: start, language: "ar" });
        if (rand() < 0.8) await db.insert(schema.consentRecord).values({ studentId: s.id, guardianId: guardianIds[0], branchId: b.id, purpose: "photos", grantedOn: start, language: "ar" });
      }
      if (rand() < 0.12) {
        await db.insert(schema.studentMedical).values({ studentId: s.id, branchId: b.id, allergies: pick(ALLERGIES), conditions: rand() < 0.3 ? "Mild asthma" : null });
      }
      await db.insert(schema.enrollment).values({ studentId: s.id, branchId: b.id, roomId: room.id, startDate: start, status: "active", isDemo: true });
      total++;
    }
  }

  // Teachers in the demo look after the first toddler class of their branch.
  const teacherEmail = code === "A" ? "teacher@yanmu.test" : "multi.role@yanmu.test";
  const [teacher] = await db.select({ id: schema.appUser.id }).from(schema.appUser).where(eq(schema.appUser.email, teacherEmail));
  const [toddlers] = await db.select().from(schema.room).where(and(eq(schema.room.branchId, b.id), eq(schema.room.nameEn, "Toddlers 1")));
  if (teacher && toddlers) await db.insert(schema.userRoom).values({ userId: teacher.id, roomId: toddlers.id, branchId: b.id }).onConflictDoNothing();

  if (code === "A") {
    // Spec §16: waitlist of 9 at Yanmu (Toddlers 6, Babies 3).
    for (const [bandKey, n] of [["toddlers", 6], ["babies", 3]] as const) {
      const bd = band(bandKey);
      for (let i = 0; i < n; i++) {
        const girl = rand() < 0.5;
        const [firstAr] = pick(girl ? GIRLS : BOYS);
        const ageDays = int(bd.minAgeMonths * 30.5, bd.maxAgeMonths * 30.5 - 40);
        await db.insert(schema.waitlistEntry).values({
          branchId: b.id,
          studentName: `${firstAr} ${pick(FATHERS)[0]} ${pick(FAMILIES)[0]}`,
          dateOfBirth: addDays(today, -ageDays),
          guardianName: pick(MOTHERS)[0],
          guardianPhone: phone(),
          requestedStartMonth: `${addMonths(today, int(0, 3)).slice(0, 7)}-01`,
          ageBandId: bd.id,
          isDemo: true,
        });
      }
    }
  }
}

console.log(`Demo children ready: ${total} (Yanmu 92, Norvale 61) and a waitlist of 9 at Yanmu.`);
console.log(await seedDemoAttendance(db));
console.log(await seedDemoMoney(db));
await client.end();
