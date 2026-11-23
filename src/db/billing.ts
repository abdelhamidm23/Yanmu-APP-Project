/**
 * Billing on the database (spec §8.4): the monthly invoice run with its preview, family credit,
 * payment recording with the default allocation, and late-fee catch-up.
 * Used by the screens (inside withUserDb, so row-level security applies) and by scripts/jobs.ts and the
 * demo seed (as the system). No "server-only" import, so scripts can use it.
 */
import { and, asc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import {
  allocate,
  dueDateFor,
  invoiceLines,
  monthEnd,
  monthStart,
  type ChildForBilling,
  type Discount,
  type FeeItem,
  type ItemType,
  type Line,
  type OpenInvoice,
  type OptionalItem,
  type PaymentMethod,
} from "../lib/billing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, typeof schema, any>;

const { enrollment, family, feeList, feeListItem, invoice, invoiceLine, payment, paymentAllocation, priceLock, room, student, studentService, discountRule } =
  schema;

async function settingValue<T>(db: Db, branchId: string, key: string, fallback: T): Promise<T> {
  const rows = (await db.execute(sql`select app_setting(${branchId}::uuid, ${key}) as v`)) as unknown as { v: T | null }[];
  return rows[0]?.v ?? fallback;
}

/** The branch's working days in a month (weekly pattern plus its holidays and extra days). */
export async function workingDaysOfMonth(db: Db, branchId: string, month: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    select to_char(d, 'YYYY-MM-DD') as day
    from generate_series(${monthStart(month)}::date, ${monthEnd(month)}::date, interval '1 day') d
    where is_working_day(${branchId}::uuid, d::date)
    order by d`)) as unknown as { day: string }[];
  return rows.map((r) => r.day);
}

export interface RunRow {
  studentId: string;
  familyId: string;
  accountNo: string;
  nameAr: string;
  nameEn: string;
  roomAr: string;
  roomEn: string;
  startDate: string;
  lines: Line[];
  total: bigint;
  prorated: boolean;
  /** Already invoiced for this month (the run skips them). */
  invoiceId: string | null;
  warning: "no_fee" | null;
}

/**
 * Preview of the invoice run for a month: one row per child with an active enrollment that started
 * by the end of the month. Children already invoiced for the month are listed with their invoice.
 */
export async function previewInvoiceRun(db: Db, branchId: string, month: string): Promise<{ rows: RunRow[]; dueDate: string; workingDays: number }> {
  const first = monthStart(month);
  const last = monthEnd(month);
  const [dueDay, prorateSetting, days] = await Promise.all([
    settingValue<number>(db, branchId, "billing.due_day", 5),
    settingValue<string>(db, branchId, "billing.prorate_new_starts", "on"),
    workingDaysOfMonth(db, branchId, month),
  ]);

  const children = await db
    .select({
      studentId: student.id,
      familyId: student.familyId,
      accountNo: family.accountNo,
      nameAr: student.fullNameAr,
      nameEn: student.fullNameEn,
      roomAr: room.nameAr,
      roomEn: room.nameEn,
      ageBandId: room.ageBandId,
      startDate: enrollment.startDate,
    })
    .from(enrollment)
    .innerJoin(student, eq(student.id, enrollment.studentId))
    .innerJoin(family, eq(family.id, student.familyId))
    .innerJoin(room, eq(room.id, enrollment.roomId))
    .where(and(eq(enrollment.branchId, branchId), eq(enrollment.status, "active"), lte(enrollment.startDate, last)))
    .orderBy(asc(room.nameEn), asc(student.fullNameEn));
  const ids = children.map((c) => c.studentId);

  const [lists, locks, services, discounts, existing, earlier] = await Promise.all([
    db
      .select({ itemType: feeListItem.itemType, ageBandId: feeListItem.ageBandId, amount: feeListItem.monthlyAmountPiastres, from: feeList.effectiveFrom })
      .from(feeListItem)
      .innerJoin(feeList, eq(feeList.id, feeListItem.feeListId))
      .where(and(eq(feeList.branchId, branchId), lte(feeList.effectiveFrom, first), or(isNull(feeList.effectiveTo), sql`${feeList.effectiveTo} >= ${first}`)))
      .orderBy(sql`${feeList.effectiveFrom} desc`),
    ids.length ? db.select().from(priceLock).where(inArray(priceLock.studentId, ids)) : [],
    ids.length ? db.select().from(studentService).where(inArray(studentService.studentId, ids)) : [],
    db.select().from(discountRule).where(and(eq(discountRule.branchId, branchId), eq(discountRule.isActive, true))),
    ids.length
      ? db.select({ id: invoice.id, studentId: invoice.studentId }).from(invoice).where(and(eq(invoice.kind, "tuition"), eq(invoice.serviceMonth, first), inArray(invoice.studentId, ids)))
      : [],
    ids.length
      ? db
          .selectDistinct({ studentId: invoice.studentId })
          .from(invoice)
          .where(and(eq(invoice.kind, "tuition"), sql`${invoice.serviceMonth} < ${first}`, inArray(invoice.studentId, ids)))
      : [],
  ]);

  // The newest fee list in force wins for each item and band.
  const fees: FeeItem[] = [];
  for (const f of lists) {
    if (!fees.some((x) => x.itemType === f.itemType && x.ageBandId === f.ageBandId)) {
      fees.push({ itemType: f.itemType as ItemType, ageBandId: f.ageBandId, amount: f.amount });
    }
  }
  const discountList: Discount[] = discounts.map((d) => ({
    name: d.name,
    type: d.type as Discount["type"],
    value: d.value,
    appliesTo: d.appliesTo as ItemType,
    startsOn: d.startsOn,
    endsOn: d.endsOn,
  }));
  const invoiced = new Map(existing.map((e) => [e.studentId!, e.id]));
  const billedBefore = new Set(earlier.map((e) => e.studentId!));

  const rows: RunRow[] = children.map((c) => {
    const input: ChildForBilling = {
      ageBandId: c.ageBandId,
      startDate: c.startDate,
      priceLocks: locks
        .filter((l) => l.studentId === c.studentId)
        .map((l) => ({ itemType: l.itemType as ItemType, amount: l.amountPiastres, startsOn: l.startsOn, endsOn: l.endsOn })),
      services: services
        .filter((s) => s.studentId === c.studentId)
        .map((s) => ({ itemType: s.itemType as OptionalItem, startsOn: s.startsOn, endsOn: s.endsOn })),
      billedBefore: billedBefore.has(c.studentId),
    };
    const r = invoiceLines(input, fees, discountList, first, days, prorateSetting !== "off");
    const base = { ...c, invoiceId: invoiced.get(c.studentId) ?? null };
    if ("error" in r) return { ...base, lines: [], total: 0n, prorated: false, warning: "no_fee" as const };
    return { ...base, lines: r.lines, total: r.total, prorated: r.prorated, warning: null };
  });
  return { rows, dueDate: dueDateFor(first, dueDay), workingDays: days.length };
}

/**
 * Posts the run: one tuition invoice per child not yet invoiced for the month, issued `issueDate`,
 * due on the due day (or the issue date, for a child billed after the due day). Then any money a
 * family paid in advance is applied to its new invoices. Returns how many invoices were created.
 */
export async function postInvoiceRun(db: Db, branchId: string, month: string, issueDate: string, opts: { isDemo?: boolean } = {}) {
  const { rows, dueDate } = await previewInvoiceRun(db, branchId, month);
  let created = 0;
  const families = new Set<string>();
  for (const r of rows) {
    if (r.invoiceId || r.warning || r.lines.length === 0) continue;
    const [inv] = await db
      .insert(invoice)
      .values({
        branchId,
        familyId: r.familyId,
        studentId: r.studentId,
        serviceMonth: monthStart(month),
        issueDate,
        dueDate: issueDate > dueDate ? issueDate : dueDate,
        kind: "tuition",
        isDemo: opts.isDemo ?? false,
      })
      .returning({ id: invoice.id });
    await db.insert(invoiceLine).values(
      r.lines.map((l) => ({
        invoiceId: inv.id,
        branchId,
        itemType: l.itemType,
        description: l.description,
        quantity: 1,
        unitPiastres: l.unit,
        amountPiastres: l.amount,
        source: l.source,
      })),
    );
    created++;
    families.add(r.familyId);
  }
  for (const f of families) await applyFamilyCredit(db, f);
  return created;
}

/** Open invoices of a family, oldest first, with what is still owed. */
export async function familyOpenInvoices(db: Db, familyId: string) {
  const rows = await db
    .select({
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      kind: invoice.kind,
      serviceMonth: invoice.serviceMonth,
      dueDate: invoice.dueDate,
      studentId: invoice.studentId,
      total: invoice.totalPiastres,
      paid: invoice.paidPiastres,
      credited: invoice.creditedPiastres,
    })
    .from(invoice)
    .where(and(eq(invoice.familyId, familyId), ne(invoice.status, "paid")))
    .orderBy(asc(invoice.dueDate), asc(invoice.invoiceNo));
  return rows.map((r) => ({ ...r, balance: r.total - r.paid - r.credited })).filter((r) => r.balance > 0n);
}

/** Money a family paid that is not on any invoice yet (payments not voided, minus what they cover). */
export async function familyCredit(db: Db, familyId: string): Promise<{ paymentId: string; left: bigint }[]> {
  const rows = (await db.execute(sql`
    select p.id as "paymentId", (p.amount_piastres - coalesce(sum(a.amount_piastres), 0))::text as "left"
    from payment p left join payment_allocation a on a.payment_id = p.id
    where p.family_id = ${familyId} and p.voided_at is null
    group by p.id, p.amount_piastres, p.received_at
    having p.amount_piastres - coalesce(sum(a.amount_piastres), 0) > 0
    order by p.received_at`)) as unknown as { paymentId: string; left: string }[];
  return rows.map((r) => ({ paymentId: r.paymentId, left: BigInt(r.left) }));
}

/** Puts a family's unused payments on its open invoices, in the default order. */
export async function applyFamilyCredit(db: Db, familyId: string) {
  const credit = await familyCredit(db, familyId);
  if (credit.length === 0) return 0;
  const [{ branchId }] = await db.select({ branchId: family.branchId }).from(family).where(eq(family.id, familyId));
  let open: OpenInvoice[] = (await familyOpenInvoices(db, familyId)).map((i) => ({ id: i.id, kind: i.kind as OpenInvoice["kind"], dueDate: i.dueDate, balance: i.balance }));
  let n = 0;
  for (const c of credit) {
    const { allocations } = allocate(c.left, open);
    for (const a of allocations) {
      await db.insert(paymentAllocation).values({ paymentId: c.paymentId, invoiceId: a.invoiceId, branchId, amountPiastres: a.amount });
      open = open.map((o) => (o.id === a.invoiceId ? { ...o, balance: o.balance - a.amount } : o));
      n++;
    }
  }
  return n;
}

/**
 * Records a payment and spreads it over the family's open invoices (spec §8.4.3).
 * The database numbers the receipt and puts cash in today's cash box.
 */
export async function recordPayment(
  db: Db,
  p: { branchId: string; familyId: string; amount: bigint; method: PaymentMethod; reference: string | null; receivedAt?: Date; isDemo?: boolean },
) {
  const [row] = await db
    .insert(payment)
    .values({
      branchId: p.branchId,
      familyId: p.familyId,
      amountPiastres: p.amount,
      method: p.method,
      reference: p.reference,
      ...(p.receivedAt ? { receivedAt: p.receivedAt } : {}),
      isDemo: p.isDemo ?? false,
    })
    .returning({ id: payment.id, receiptNo: payment.receiptNo });
  const open = (await familyOpenInvoices(db, p.familyId)).map((i) => ({ id: i.id, kind: i.kind as OpenInvoice["kind"], dueDate: i.dueDate, balance: i.balance }));
  const { allocations, credit } = allocate(p.amount, open);
  for (const a of allocations) {
    await db.insert(paymentAllocation).values({ paymentId: row.id, invoiceId: a.invoiceId, branchId: p.branchId, amountPiastres: a.amount });
  }
  return { ...row, credit };
}

/** Brings late fees up to today (idempotent; the nightly job does the same). */
export async function accrueLateFees(db: Db, branchId: string, today: string): Promise<number> {
  const rows = (await db.execute(sql`select app_accrue_late_fees(${branchId}::uuid, ${today}::date) as n`)) as unknown as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

/** Families of a branch with what they owe now (tuition and late fees apart). */
export async function familyBalances(db: Db, branchId: string) {
  return (await db.execute(sql`
    select f.id, f.account_no as "accountNo", f.display_name as "displayName",
      coalesce(sum(i.total_piastres - i.paid_piastres - i.credited_piastres) filter (where i.kind <> 'late_fee'), 0)::text as "tuition",
      coalesce(sum(i.total_piastres - i.paid_piastres - i.credited_piastres) filter (where i.kind = 'late_fee'), 0)::text as "lateFees"
    from family f join invoice i on i.family_id = f.id and i.status <> 'paid'
    where f.branch_id = ${branchId}
    group by f.id order by f.account_no`)) as unknown as { id: string; accountNo: string; displayName: string; tuition: string; lateFees: string }[];
}

