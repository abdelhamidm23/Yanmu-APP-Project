/**
 * Demo money (spec §16), called by `pnpm seed:demo`: three months of fee lists, invoices, payments,
 * late fees, cash box days, expenses and approvals for the demo children, so the money screens show
 * figures close to the concept (Yanmu billed about EGP 430K a month, Norvale about EGP 230K;
 * most families pay in the first days of the month, some late, a few are behind).
 *
 * The days are played in order, as they would have happened: the invoice run on the 1st, late fees
 * each working day, payments taken by the accountant, cash box opened and closed, expenses by the branch
 * manager, approvals by the company manager and owner. Every row is made up and flagged is_demo;
 * demo documents have their own numbers (DEMO-A-R2026-00001), so wiping them leaves no gap in real ones.
 * Runs once: if demo invoices already exist it only catches up today (cash box and late fees).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { accrueLateFees, familyOpenInvoices, postInvoiceRun, recordPayment } from "../src/db/billing";
import { daysOfMonth, monthStart, shiftMonth, type PaymentMethod } from "../src/lib/billing";
import { cairoWallToUtc, todayInCairo } from "../src/lib/calendar";
import { DEMO_VENDOR_NAMES } from "./wipe-demo";

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let seed = 20261101;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const EGP = (v: number) => BigInt(Math.round(v * 100));

// Monthly prices in EGP by age band, registration once, transport monthly.
const PRICES: Record<"A" | "B", { babies: number; toddlers: number; juniors: number; seniors: number; registration: number; transport: number }> = {
  A: { babies: 5600, toddlers: 5200, juniors: 4700, seniors: 4300, registration: 2000, transport: 900 },
  B: { babies: 4600, toddlers: 4200, juniors: 3800, seniors: 3500, registration: 1500, transport: 800 },
};
const FLOAT = EGP(1000);
const DEMO_VENDORS = DEMO_VENDOR_NAMES;
// Routine spending per month: [category, times a month, EGP from, EGP to, vendor]
const ROUTINE: [string, number, number, number, string][] = [
  ["food", 4, 4200, 6800, "Cairo Fresh Foods"],
  ["utilities", 2, 3800, 7600, "Nile Utilities"],
  ["cleaning", 2, 1400, 2600, "Clean Pro Egypt"],
  ["consumables", 3, 600, 1900, "Al Amal Stationery"],
  ["learning", 1, 2200, 4200, "Smart Kids Supplies"],
  ["maintenance", 1, 1200, 3600, "Delta Maintenance"],
];
// 1x1 PNG standing in for a receipt photo.
const RECEIPT_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

type Profile = "good" | "late" | "behind" | "far";

async function as(tx: Tx, userId: string | null) {
  await tx.execute(sql`select set_config('app.user_id', ${userId ?? ""}, true)`);
}

async function userId(db: Db, email: string): Promise<string | null> {
  const [u] = await db.select({ id: schema.appUser.id }).from(schema.appUser).where(eq(schema.appUser.email, email));
  return u?.id ?? null;
}

async function isWorkingDay(db: Db | Tx, branchId: string, day: string) {
  const [r] = (await db.execute(sql`select is_working_day(${branchId}::uuid, ${day}::date) as w`)) as unknown as { w: boolean }[];
  return r.w;
}

/** A moment on a Cairo day, e.g. 10:35. */
const at = (day: string, h: number, m: number) => {
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(cairoWallToUtc(y, mo, d).getTime() + (h * 60 + m) * 60_000);
};

export async function seedDemoMoney(db: Db): Promise<string> {
  const today = todayInCairo();
  const branches = await db.select().from(schema.branch).where(inArray(schema.branch.code, ["A", "B"]));
  const [already] = (await db.execute(sql`select count(*)::int as n from invoice where is_demo`)) as unknown as { n: number }[];
  const users = {
    owner: await userId(db, "owner@yanmu.test"),
    cm: await userId(db, "company.manager@yanmu.test"),
    accountant: await userId(db, "accountant@yanmu.test"),
    A: { bm: await userId(db, "branch.manager@yanmu.test") },
    B: { bm: await userId(db, "branch.manager.b@yanmu.test") },
  };

  if (already.n > 0) {
    // A running demo: open today's cash box and catch up late fees, nothing else.
    for (const b of branches) {
      await db.transaction(async (tx) => {
        await as(tx, null);
        if (await isWorkingDay(tx, b.id, today)) {
          await tx.insert(schema.cashSession).values({ branchId: b.id, date: today, openingFloatPiastres: FLOAT, isDemo: true }).onConflictDoNothing();
        }
        await accrueLateFees(tx, b.id, today);
      });
    }
    return "Demo money already there: today's cash box opened and late fees caught up.";
  }

  const first = shiftMonth(today, -2);
  const months = [first, shiftMonth(today, -1), monthStart(today)];
  const bands = await db.select().from(schema.ageBand);
  const categories = await db.select().from(schema.expenseCategory);
  const cat = (key: string) => categories.find((c) => c.key === key)!;
  const [org] = await db.select().from(schema.organization).limit(1);
  const vendorIds = new Map<string, string>();
  for (const name of DEMO_VENDORS) {
    const [v] = await db.insert(schema.vendor).values({ orgId: org.id, name }).onConflictDoNothing().returning({ id: schema.vendor.id });
    const id = v?.id ?? (await db.select({ id: schema.vendor.id }).from(schema.vendor).where(sql`lower(${schema.vendor.name}) = lower(${name})`))[0].id;
    vendorIds.set(name, id);
  }
  const lines: string[] = [];

  for (const b of branches) {
    const code = b.code as "A" | "B";
    const u = users[code];
    // Who takes payments and runs the cash box: the accountant (owner, 2026-11-23).
    const cashier = users.accountant;
    const p = PRICES[code];

    // Fee list in force from the first demo month (only when the branch has no real one).
    const [real] = await db.select({ id: schema.feeList.id }).from(schema.feeList).where(and(eq(schema.feeList.branchId, b.id), eq(schema.feeList.isDemo, false)));
    if (!real) {
      const [list] = await db
        .insert(schema.feeList)
        .values({ branchId: b.id, name: code === "A" ? "Demo prices 2026/27" : "Demo prices 2026/27 (Norvale)", effectiveFrom: first, isDemo: true })
        .returning({ id: schema.feeList.id });
      const band = (key: string) => bands.find((x) => x.key === key)?.id ?? null;
      await db.insert(schema.feeListItem).values([
        ...(["babies", "toddlers", "juniors", "seniors"] as const)
          .filter((k) => band(k))
          .map((k) => ({ feeListId: list.id, branchId: b.id, ageBandId: band(k), itemType: "tuition", monthlyAmountPiastres: EGP(p[k]) })),
        { feeListId: list.id, branchId: b.id, ageBandId: null, itemType: "registration", monthlyAmountPiastres: EGP(p.registration) },
        { feeListId: list.id, branchId: b.id, ageBandId: null, itemType: "transport", monthlyAmountPiastres: EGP(p.transport) },
      ]);
    }

    // Children: transport for about one in nine; a few keep an older price.
    const kids = (await db.execute(sql`
      select s.id, s.family_id as "familyId", e.start_date as "startDate" from student s
      join enrollment e on e.student_id = s.id and e.status = 'active'
      where s.branch_id = ${b.id} and s.is_demo order by s.student_no`)) as unknown as { id: string; familyId: string; startDate: string }[];
    await db.transaction(async (tx) => {
      await as(tx, users.cm);
      let locks = 0;
      for (const k of kids) {
        if (rand() < 0.11) {
          await tx.insert(schema.studentService).values({ studentId: k.id, branchId: b.id, itemType: "transport", startsOn: k.startDate > first ? k.startDate : first });
        }
        if (k.startDate < shiftMonth(first, -10) && locks < (code === "A" ? 6 : 4) && rand() < 0.2) {
          locks++;
          await tx.insert(schema.priceLock).values({
            branchId: b.id,
            studentId: k.id,
            itemType: "tuition",
            amountPiastres: EGP(code === "A" ? 3900 : 3200),
            reason: pick(["Price agreed at enrolment in 2025", "Founding family discount kept", "Staff child, agreed by the owner"]),
            startsOn: k.startDate,
            isDemo: true,
          });
        }
      }
    });

    // How each family pays (spec §16: most on time, some late, a few behind).
    const families = [...new Set(kids.map((k) => k.familyId))];
    const profile = new Map<string, Profile>();
    for (const f of families) {
      const r = rand();
      profile.set(f, r < 0.58 ? "good" : r < 0.85 ? "late" : r < 0.97 ? "behind" : "far");
    }
    const [receipt] = await db
      .insert(schema.attachment)
      .values({ branchId: b.id, fileName: "demo-receipt.png", mimeType: "image/png", sizeBytes: RECEIPT_PNG.length, data: RECEIPT_PNG })
      .returning({ id: schema.attachment.id });

    // Payment days per family and month. "full" pays everything owed (late fees too);
    // "tuition" pays the tuition owed only; "half" pays about half of the tuition owed.
    type Mode = "full" | "tuition" | "half";
    const plan = new Map<string, { familyId: string; mode: Mode }[]>();
    const add = (day: string, familyId: string, mode: Mode) => {
      if (day > today) return;
      plan.set(day, [...(plan.get(day) ?? []), { familyId, mode }]);
    };
    for (const [i, m] of months.entries()) {
      const days = daysOfMonth(m);
      for (const f of families) {
        const pr = profile.get(f)!;
        const current = i === 2;
        if (pr === "good") add(days[int(0, 4)], f, "full");
        else if (pr === "late" && !(current && rand() < 0.55)) add(days[int(5, 9)], f, "full");
        else if (pr === "behind" && !current) add(days[int(12, 24)], f, "full");
        else if (pr === "far" && i === 0) add(days[int(15, 25)], f, "half");
      }
    }

    const carry: { familyId: string; mode: Mode }[] = [];
    let cashShortDone = false;
    const shortDay = (() => {
      // The cash box was short a few working days ago and nobody has checked it yet (alert on Today).
      const d = new Date(Date.parse(`${today}T00:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10);
      return d;
    })();
    let receipts = 0;
    let expenses = 0;
    let voided = false;

    for (const m of months) {
      for (const day of daysOfMonth(m)) {
        if (day > today) break;
        await db.transaction(async (tx) => {
          if (day === m) {
            await as(tx, null);
            await postInvoiceRun(tx, b.id, m, day);
          }
          // A family that meant to come on a day off comes on the next working day.
          if (!(await isWorkingDay(tx, b.id, day))) {
            carry.push(...(plan.get(day) ?? []));
            return;
          }
          await as(tx, null);
          await accrueLateFees(tx, b.id, day);
          await tx.insert(schema.cashSession).values({ branchId: b.id, date: day, openingFloatPiastres: FLOAT, isDemo: true });

          // Payments taken by the accountant (owner, 2026-11-23: money is the accountant's), in the order the families came.
          await as(tx, cashier);
          const todays = [...carry.splice(0), ...(plan.get(day) ?? [])];
          for (const [j, { familyId, mode }] of todays.entries()) {
            const open = await familyOpenInvoices(tx, familyId);
            const owed = open.filter((x) => mode === "full" || x.kind === "tuition").reduce((s, x) => s + x.balance, 0n);
            if (owed <= 0n) continue;
            const amount = mode === "half" ? (owed / 2n / 10000n) * 10000n || owed : owed;
            const method: PaymentMethod = pick(["cash", "cash", "cash", "cash", "instapay", "instapay", "card", "bank_transfer", "wallet"] as const);
            const when = at(day, 8 + Math.floor((j * 7) / Math.max(1, todays.length)), int(0, 59));
            if (day === today && when > new Date()) continue;
            await recordPayment(tx, {
              branchId: b.id,
              familyId,
              amount,
              method,
              reference: method === "cash" ? null : `${method === "instapay" ? "IPN" : method === "card" ? "POS" : "TRX"}-${int(100000, 999999)}`,
              receivedAt: when,
              isDemo: true,
            });
            receipts++;
            // One payment was keyed twice by mistake last month and voided by the company manager (a second person, spec §8.4.3).
            if (code === "A" && !voided && m === months[1] && method !== "cash" && users.cm && users.cm !== cashier) {
              const dup = await recordPayment(tx, { branchId: b.id, familyId, amount, method, reference: "entered twice", receivedAt: new Date(when.getTime() + 120_000), isDemo: true });
              await as(tx, users.cm);
              await tx.execute(sql`select app_void_payment(${dup.id}::uuid, 'Entered twice by mistake; the first receipt stands.')`);
              await as(tx, cashier);
              voided = true;
            }
          }

          // Routine spending by the branch manager, spread over the month.
          await as(tx, u.bm);
          const dom = Number(day.slice(8));
          for (const [key, times, lo, hi, vendor] of ROUTINE) {
            const scale = code === "A" ? 1 : 0.65;
            if (!Array.from({ length: times }, (_, k) => 3 + Math.floor((k * 26) / times)).includes(dom)) continue;
            const amount = EGP(Math.round(int(lo, hi) * scale));
            await tx.insert(schema.expense).values({
              branchId: b.id,
              categoryId: cat(key).id,
              vendorId: vendorIds.get(vendor),
              spentOn: day,
              amountPiastres: amount,
              paymentMethod: amount <= EGP(900) ? "cash" : "bank_transfer",
              description: `${cat(key).nameEn} (${day.slice(0, 7)})`,
              receiptAttachmentId: receipt.id,
              isDemo: true,
            });
            expenses++;
          }

          // Close the box (not today: the accountant is still working).
          if (day < today) {
            await as(tx, cashier);
            const [s] = (await tx.execute(sql`select id from cash_session where branch_id = ${b.id} and date = ${day}`)) as unknown as { id: string }[];
            const [tot] = (await tx.execute(sql`select cash_in::text as i, cash_out::text as o from app_cash_session_totals(${s.id}::uuid)`)) as unknown as { i: string; o: string }[];
            const expected = FLOAT + BigInt(tot.i) - BigInt(tot.o);
            const short = code === "A" && !cashShortDone && day >= shortDay ? EGP(250) : 0n;
            if (short) cashShortDone = true;
            const handed = expected - FLOAT > 0n ? expected - FLOAT : 0n;
            await tx.execute(
              sql`select app_close_cash_session(${s.id}::uuid, ${expected - handed - short}::bigint, ${handed}::bigint, ${handed > 0n ? "Bank deposit" : ""})`,
            );
            // The accountant checks closed days older than two days, except the short one.
            if (!short && day < new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10) && users.accountant) {
              await as(tx, users.accountant);
              await tx.execute(sql`select app_reconcile_cash_session(${s.id}::uuid)`);
            }
          }
        });
      }
    }
    await db.transaction(async (tx) => {
      await as(tx, null);
      await accrueLateFees(tx, b.id, today);
    });

    // Approvals (spec §8.6): something for the company manager and the owner to decide in the inbox.
    if (u.bm && users.cm) {
      await db.transaction(async (tx) => {
        const lastMonthDay = daysOfMonth(months[1])[14];
        const thisMonthDay = today > months[2] ? daysOfMonth(months[2])[Math.min(Number(today.slice(8)) - 2, 6)] : today;
        const unusual = async (key: string, egp: number, description: string, spentOn: string, extra: Partial<typeof schema.expense.$inferInsert> = {}) => {
          await as(tx, u.bm);
          const [e] = await tx
            .insert(schema.expense)
            .values({
              branchId: b.id,
              categoryId: cat(key).id,
              spentOn,
              amountPiastres: EGP(egp),
              paymentMethod: "bank_transfer",
              description,
              receiptAttachmentId: receipt.id,
              isDemo: true,
              ...extra,
            })
            .returning({ id: schema.expense.id, requestId: schema.expense.approvalRequestId });
          return e.requestId!;
        };
        const decide = async (who: string | null, requestId: string, decision: string, comment: string) => {
          await as(tx, who);
          await tx.execute(sql`select app_decide_money(${requestId}::uuid, ${decision}, ${comment})`);
        };
        if (code === "A") {
          const r1 = await unusual("security", 5500, "Security camera yearly service", lastMonthDay);
          await decide(users.cm, r1, "approve", "Yearly contract, same as last year.");
          await unusual("transport", 6800, "New tyres for the school bus", thisMonthDay);
          const r3 = await unusual("maintenance", 34500, "New air conditioner for Babies 1", thisMonthDay, { flaggedNote: "Old unit failed; two quotes attached." });
          await decide(users.cm, r3, "recommend_approve", "Two quotes compared; this is the cheaper one.");
          const r4 = await unusual("maintenance", 9000, "Paint Seniors 2 class", today, { isRequest: true, flaggedNote: "Bigger job than our usual repairs.", receiptAttachmentId: null });
          await decide(users.cm, r4, "approve", "Go ahead; please add the receipt when done.");
        } else {
          const r1 = await unusual("other", 7000, "Staff outing", lastMonthDay);
          await decide(users.cm, r1, "reject", "Not in this year's budget.");
          const r2 = await unusual("marketing", 4200, "Flyers for the open day", thisMonthDay);
          await decide(users.cm, r2, "question", "Which events will these be used for?");
        }
        // A late-fee waiver asked by the accountant, waiting for a decision.
        if (users.accountant) {
          const [lf] = (await tx.execute(sql`
            select id, (total_piastres - paid_piastres - credited_piastres) as bal from invoice
            where branch_id = ${b.id} and is_demo and kind = 'late_fee' and status <> 'paid' and total_piastres - paid_piastres - credited_piastres >= 150000
            order by total_piastres limit 1`)) as unknown as { id: string; bal: string }[];
          if (lf) {
            await as(tx, users.accountant);
            await tx.insert(schema.creditNote).values({
              invoiceId: lf.id,
              branchId: b.id,
              kind: "waiver",
              amountPiastres: EGP(1500),
              reason: "Family was travelling for a funeral; agreed with the branch manager.",
              isDemo: true,
            });
          }
        }
      });
    }
    lines.push(`${b.code}: ${receipts} receipts, ${expenses} routine expenses`);
  }
  return `Demo money ready (${months.map((m) => m.slice(0, 7)).join(", ")}): ${lines.join("; ")}.`;
}
