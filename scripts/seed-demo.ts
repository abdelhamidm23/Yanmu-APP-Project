/**
 * Demo children for the online preview (spec §16): Branch A 92 children in 7 rooms, Branch B 61 in 5,
 * and a Branch A waitlist of 9 (Toddlers 6, Babies 3). All names are made up and every row is
 * flagged is_demo. `pnpm seed:wipe-demo` removes them again.
 *
 * Refuses to run in production unless DEMO_MODE=true.
 * Usage: pnpm seed:demo            (does nothing if demo children already exist)
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

// Rooms per branch: [band key, English name, Arabic name, capacity, children]
const PLAN: Record<"A" | "B", [string, string, string, number, number][]> = {
  A: [
    ["babies", "Babies 1", "الرضع ١", 9, 9],
    ["toddlers", "Toddlers 1", "الدارجون ١", 12, 11],
    ["toddlers", "Toddlers 2", "الدارجون ٢", 12, 11],
    ["juniors", "Juniors 1", "البراعم ١", 18, 15],
    ["juniors", "Juniors 2", "البراعم ٢", 18, 15],
    ["seniors", "Seniors 1", "الكبار ١", 18, 16],
    ["seniors", "Seniors 2", "الكبار ٢", 18, 15],
  ],
  B: [
    ["babies", "Babies 1", "الرضع ١", 9, 6],
    ["toddlers", "Toddlers 1", "الدارجون ١", 12, 12],
    ["juniors", "Juniors 1", "البراعم ١", 18, 18],
    ["seniors", "Seniors 1", "الكبار ١", 18, 13],
    ["seniors", "Seniors 2", "الكبار ٢", 18, 12],
  ],
};

const phone = () => `01${pick(["0", "1", "2", "5"])}${String(int(0, 99999999)).padStart(8, "0")}`;
const today = todayInCairo();

const reset = process.argv.includes("--reset");
const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.student).where(eq(schema.student.isDemo, true));
if (existing.n > 0 && !reset) {
  console.log(`Demo children already there (${existing.n}). Use --reset to recreate them.`);
  await client.end();
  process.exit(0);
}
if (existing.n > 0) await wipeDemo(db);

const bands = await db.select().from(schema.ageBand);
const band = (key: string) => bands.find((b) => b.key === key)!;
const branches = await db.select().from(schema.branch).where(inArray(schema.branch.code, ["A", "B"]));

let total = 0;
for (const code of ["A", "B"] as const) {
  const b = branches.find((x) => x.code === code);
  if (!b) throw new Error(`Branch ${code} not found. Run pnpm seed:base first.`);
  let familyNo = 0;
  let childNo = 0;
  const [{ maxF }] = (await db.execute(sql`select coalesce(max(substring(account_no from '[0-9]+$')::int), 0) as "maxF" from family where account_no like ${code + "-F%"}`)) as unknown as { maxF: number }[];
  const [{ maxS }] = (await db.execute(sql`select coalesce(max(substring(student_no from '[0-9]+$')::int), 0) as "maxS" from student where student_no ~ ${"^" + code + "-[0-9]+$"}`)) as unknown as { maxS: number }[];
  familyNo = maxF;
  childNo = maxS;

  // Families with a child in an older room sometimes have a younger brother or sister too.
  const openFamilies: { id: string; surname: [string, string]; guardians: string[] }[] = [];
  for (const [bandKey, nameEn, nameAr, capacity, count] of PLAN[code]) {
    const bd = band(bandKey);
    let [room] = await db.select().from(schema.room).where(and(eq(schema.room.branchId, b.id), eq(schema.room.nameEn, nameEn)));
    if (!room) [room] = await db.insert(schema.room).values({ branchId: b.id, nameEn, nameAr, ageBandId: bd.id, capacity }).returning();

    for (let i = 0; i < count; i++) {
      const girl = rand() < 0.5;
      const [firstAr, firstEn] = pick(girl ? GIRLS : BOYS);
      // Age inside the room's band, in days, so some are close to moving up.
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

  // Teachers in the demo look after the first toddler room of their branch.
  const teacherEmail = code === "A" ? "teacher@yanmu.test" : "multi.role@yanmu.test";
  const [teacher] = await db.select({ id: schema.appUser.id }).from(schema.appUser).where(eq(schema.appUser.email, teacherEmail));
  const [toddlers] = await db.select().from(schema.room).where(and(eq(schema.room.branchId, b.id), eq(schema.room.nameEn, "Toddlers 1")));
  if (teacher && toddlers) await db.insert(schema.userRoom).values({ userId: teacher.id, roomId: toddlers.id, branchId: b.id }).onConflictDoNothing();

  if (code === "A") {
    // Spec §16: waitlist of 9 at Branch A (Toddlers 6, Babies 3).
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

console.log(`Demo children ready: ${total} (Branch A 92, Branch B 61) and a waitlist of 9 at Branch A.`);
await client.end();
