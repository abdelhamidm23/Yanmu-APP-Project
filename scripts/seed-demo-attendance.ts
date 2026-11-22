/**
 * Demo staff and today's attendance (spec §16), called by `pnpm seed:demo`:
 *   Staff present 24 / 26 at Yanmu, 15 / 17 at Norvale.
 *   Children today: Yanmu 82 of 89 (6 of 6 classes), Norvale 43 of 48 (6 of 8 classes; Seniors 1 and 3 not taken yet).
 *   One ratio breach: Norvale Toddlers 1, 12 children with 2 carers (1:6, required 1:4).
 * Children whose made-up pickup time (13:00 to 16:10) has already passed are checked out to a parent,
 * and the morning ratio snapshots are recorded, so the evening demo still shows today's breach.
 * Every row is made up and flagged is_demo. Runs again on a later day to fill that day,
 * so a demo left running keeps showing a live "today".
 */
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { cairoWallToUtc, todayInCairo } from "../src/lib/calendar";

type Db = PostgresJsDatabase<typeof schema>;

// [class English name, carers in the class, carers absent today]
const CARERS: Record<"A" | "B", [string, number, number][]> = {
  A: [["Babies 1", 4, 1], ["Toddlers 1", 3, 0], ["Juniors 1", 4, 0], ["Juniors 2", 3, 0], ["Seniors 1", 5, 1], ["Seniors 2", 4, 0]],
  B: [["Babies 1", 2, 0], ["Toddlers 1", 3, 1], ["Toddlers 2", 1, 0], ["Juniors 1", 2, 0], ["Juniors 2", 2, 0], ["Seniors 1", 1, 0], ["Seniors 2", 1, 0], ["Seniors 3", 1, 0]],
};
// Other staff: [Arabic job title, absent today]
const OTHERS: Record<"A" | "B", [string, boolean][]> = {
  A: [["طاهية", false], ["عاملة نظافة", false], ["موظفة استقبال", false]],
  B: [["طاهية", false], ["عاملة نظافة", true], ["موظفة استقبال", false], ["مشرف الحافلة", false]],
};
// Children today per class: [present, absent, excused]; classes not listed have no roll call yet.
const CHILDREN: Record<"A" | "B", Record<string, [number, number, number]>> = {
  A: { "Babies 1": [8, 1, 0], "Toddlers 1": [10, 0, 1], "Juniors 1": [18, 1, 1], "Juniors 2": [10, 1, 0], "Seniors 1": [18, 2, 1], "Seniors 2": [18, 2, 0] },
  B: { "Babies 1": [5, 1, 0], "Toddlers 1": [12, 0, 0], "Toddlers 2": [4, 1, 0], "Juniors 1": [8, 1, 0], "Juniors 2": [8, 1, 0], "Seniors 2": [6, 1, 0] },
};
const EXCUSES = ["مريض", "موعد طبيب", "سفر مع الأسرة"];

const WOMEN: [string, string][] = [
  ["هالة", "Hala"], ["سوزان", "Suzan"], ["نرمين", "Nermeen"], ["غادة", "Ghada"], ["مروة", "Marwa"], ["أسماء", "Asmaa"],
  ["ولاء", "Walaa"], ["نشوى", "Nashwa"], ["عبير", "Abeer"], ["رشا", "Rasha"], ["إيناس", "Enas"], ["شيرين", "Sherine"],
  ["ياسمين", "Yasmine"], ["نيرة", "Nayera"], ["آية", "Aya"], ["بسمة", "Basma"], ["فاطمة", "Fatma"], ["زينب", "Zeinab"],
];
const SURNAMES: [string, string][] = [
  ["عبد الرحمن", "Abdelrahman"], ["الجمال", "El-Gamal"], ["سعيد", "Saeed"], ["بدوي", "Badawy"], ["رضوان", "Radwan"], ["الشافعي", "El-Shafei"],
  ["عزت", "Ezzat"], ["مرسي", "Morsy"], ["هيكل", "Heikal"], ["قنديل", "Kandil"], ["لطفي", "Lotfy"], ["توفيق", "Tawfik"],
];

let seed = 8311;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

export async function seedDemoAttendance(outer: Db): Promise<string> {
  return outer.transaction((tx) => fill(tx as unknown as Db));
}

async function fill(db: Db): Promise<string> {
  const today = todayInCairo();
  const [y, m, d] = today.split("-").map(Number);
  const at = (h: number, min: number) => cairoWallToUtc(y, m, d, h, min);
  const branches = await db.select().from(schema.branch);
  const lines: string[] = [];

  for (const code of ["A", "B"] as const) {
    const b = branches.find((x) => x.code === code);
    if (!b) continue;
    const rooms = await db.select().from(schema.room).where(eq(schema.room.branchId, b.id));
    const roomId = (nameEn: string) => rooms.find((r) => r.nameEn === nameEn)?.id ?? null;

    // Staff, once.
    let people = await db.select().from(schema.staff).where(and(eq(schema.staff.branchId, b.id), eq(schema.staff.isDemo, true)));
    const absentNos = new Set<string>();
    if (!people.length) {
      let no = code === "A" ? 100 : 200;
      const rows: (typeof schema.staff.$inferInsert)[] = [];
      for (const [room, count, absent] of CARERS[code]) {
        for (let i = 0; i < count; i++) {
          const [fa, fe] = pick(WOMEN);
          const [sa, se] = pick(SURNAMES);
          no++;
          rows.push({
            branchId: b.id,
            fullNameAr: `${fa} ${sa}`,
            fullNameEn: `${fe} ${se}`,
            jobTitle: i === 0 ? "مربية" : "مساعدة مربية",
            isQualifiedCarer: true,
            defaultRoomId: roomId(room),
            deviceEmployeeNo: String(no),
            startDate: `${y - int(1, 4)}-09-01`,
            isDemo: true,
          });
          if (i >= count - absent) absentNos.add(String(no));
        }
      }
      for (const [job, absent] of OTHERS[code]) {
        const [fa, fe] = pick(WOMEN);
        const [sa, se] = pick(SURNAMES);
        no++;
        rows.push({ branchId: b.id, fullNameAr: `${fa} ${sa}`, fullNameEn: `${fe} ${se}`, jobTitle: job, isQualifiedCarer: false, deviceEmployeeNo: String(no), startDate: `${y - int(1, 4)}-09-01`, isDemo: true });
        if (absent) absentNos.add(String(no));
      }
      people = await db.insert(schema.staff).values(rows).returning();

      // The demo teacher at Yanmu is one of the Toddlers 1 carers, so "My class" works for them.
      if (code === "A") {
        const [teacher] = await db.select({ id: schema.appUser.id }).from(schema.appUser).where(eq(schema.appUser.email, "teacher@yanmu.test"));
        const mine = people.find((p) => p.defaultRoomId === roomId("Toddlers 1"));
        if (teacher && mine) {
          await db.update(schema.staff).set({ userId: teacher.id, fullNameEn: "Teacher A (test)" }).where(eq(schema.staff.id, mine.id));
        }
      }
    } else {
      // A later day: same people absent, so the figures match spec §16 again.
      for (const [room, count, absent] of CARERS[code]) {
        const inRoom = people.filter((p) => p.defaultRoomId === roomId(room) && p.isQualifiedCarer).sort((p, q) => Number(p.deviceEmployeeNo) - Number(q.deviceEmployeeNo));
        inRoom.slice(count - absent).forEach((p) => absentNos.add(p.deviceEmployeeNo ?? ""));
      }
      const others = people.filter((p) => !p.isQualifiedCarer).sort((p, q) => Number(p.deviceEmployeeNo) - Number(q.deviceEmployeeNo));
      OTHERS[code].forEach(([, absent], i) => absent && others[i] && absentNos.add(others[i].deviceEmployeeNo ?? ""));
    }

    // Today's fingerprint file and staff days, once a day.
    const [hasDay] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.staffAttendanceDay)
      .where(and(eq(schema.staffAttendanceDay.branchId, b.id), eq(schema.staffAttendanceDay.date, today)));
    if (hasDay.n === 0) {
      const [batch] = await db
        .insert(schema.importBatch)
        .values({ branchId: b.id, kind: "staff_punches", fileName: `demo-fingerprint-${today}.xlsx`, rowCount: 0 })
        .returning({ id: schema.importBatch.id });
      // Two people late (the 4th and 10th to arrive); an out punch once 4 PM to 5 PM has passed.
      let arrived = 0;
      let punches = 0;
      for (const p of people) {
        if (absentNos.has(p.deviceEmployeeNo ?? "")) {
          await db.insert(schema.staffAttendanceDay).values({ staffId: p.id, date: today, branchId: b.id, status: "absent", isDemo: true });
          continue;
        }
        arrived++;
        const isLate = arrived === 4 || arrived === 10;
        const firstIn = isLate ? at(8, int(14, 35)) : at(7, int(35, 59));
        const out = at(16, int(5, 55));
        const lastOut = out.getTime() < Date.now() ? out : null;
        for (const punchedAt of lastOut ? [firstIn, lastOut] : [firstIn]) {
          await db.insert(schema.staffPunch).values({
            branchId: b.id,
            staffId: p.id,
            deviceEmployeeNo: p.deviceEmployeeNo ?? "",
            personName: p.fullNameEn,
            punchedAt,
            device: "Entrance",
            importBatchId: batch.id,
            isDemo: true,
          });
          punches++;
        }
        await db.insert(schema.staffAttendanceDay).values({ staffId: p.id, date: today, branchId: b.id, firstIn, lastOut, status: isLate ? "late" : "present", isDemo: true });
      }
      await db.update(schema.importBatch).set({ rowCount: punches }).where(eq(schema.importBatch.id, batch.id));
      lines.push(`${b.nameEn}: staff ${people.length - absentNos.size} of ${people.length} present`);
    }

    // Children's roll call, once a day.
    const [hasRoll] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.studentAttendance)
      .where(and(eq(schema.studentAttendance.branchId, b.id), eq(schema.studentAttendance.date, today)));
    if (hasRoll.n > 0) continue;
    let presentTotal = 0;
    let expectedTotal = 0;
    for (const [room, [present, absent, excused]] of Object.entries(CHILDREN[code])) {
      const rid = roomId(room);
      if (!rid) continue;
      const kids = await db
        .select({ studentId: schema.enrollment.studentId })
        .from(schema.enrollment)
        .innerJoin(schema.student, eq(schema.student.id, schema.enrollment.studentId))
        .where(and(eq(schema.enrollment.roomId, rid), eq(schema.enrollment.status, "active"), eq(schema.student.isDemo, true)))
        .orderBy(schema.student.studentNo);
      const statuses = [...Array(present).fill("present"), ...Array(absent).fill("absent"), ...Array(excused).fill("excused")] as string[];
      // Absences spread through the list rather than the last names only.
      for (let i = statuses.length - 1; i > 0; i--) {
        const j = int(0, i);
        [statuses[i], statuses[j]] = [statuses[j], statuses[i]];
      }
      let inRoom = 0;
      for (const [i, k] of kids.entries()) {
        const status = statuses[i];
        if (!status) break;
        const tapped = at(8, int(0, 50));
        const pickup = at(int(13, 15), int(0, 59));
        const gone = status === "present" && pickup.getTime() < Date.now();
        const [parent] = gone
          ? await db
              .select({ id: schema.studentGuardian.guardianId })
              .from(schema.studentGuardian)
              .where(and(eq(schema.studentGuardian.studentId, k.studentId), eq(schema.studentGuardian.canPickUp, true)))
              .limit(1)
          : [];
        if (status === "present") inRoom++;
        await db.insert(schema.studentAttendance).values({
          branchId: b.id,
          roomId: rid,
          studentId: k.studentId,
          date: today,
          status,
          excuseReason: status === "excused" ? pick(EXCUSES) : null,
          checkInAt: status === "present" ? tapped : null,
          checkOutAt: parent ? pickup : null,
          collectedByGuardianId: parent?.id ?? null,
          clientAt: parent ? pickup : tapped,
          isDemo: true,
        });
        if (status === "present") presentTotal++;
        if (status !== "excused") expectedTotal++;
      }
      // The 9 AM ratio check for the room, as the app records it after roll call (spec §8.3).
      const carers = people.filter((p) => p.isQualifiedCarer && p.defaultRoomId === rid && !absentNos.has(p.deviceEmployeeNo ?? "")).length;
      const band = rooms.find((r) => r.id === rid)!;
      const [{ per }] = await db.select({ per: schema.ageBand.childrenPerStaff }).from(schema.ageBand).where(eq(schema.ageBand.id, band.ageBandId));
      const required = Math.ceil(inRoom / per);
      await db.insert(schema.ratioSnapshot).values({
        branchId: b.id,
        roomId: rid,
        takenAt: at(9, 0),
        childrenPresent: inRoom,
        carersPresent: carers,
        requiredCarers: required,
        isBreach: carers < required,
        reason: "roll_call",
        isDemo: true,
      });
    }
    lines.push(`${b.nameEn}: children ${presentTotal} of ${expectedTotal} present`);
  }
  return lines.length ? `Today's demo attendance (${today}): ${lines.join("; ")}.` : `Demo attendance for ${today} already there.`;
}
