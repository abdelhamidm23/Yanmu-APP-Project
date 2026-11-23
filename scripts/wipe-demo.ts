/**
 * Removes every demo child, family, guardian, enrollment, waitlist entry, staff member,
 * attendance record, demo money (invoices, payments, cash days, expenses, approvals), demo incidents and issues,
 * and demo daily and month closes (spec §16).
 * Rooms stay: they are settings, and the owner may have renamed them.
 * Usage: pnpm seed:wipe-demo
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { fileURLToPath } from "node:url";

/** Vendors the demo adds (scripts/seed-demo-money.ts); removed again when nothing else uses them. */
export const DEMO_VENDOR_NAMES = ["Cairo Fresh Foods", "Nile Utilities", "Clean Pro Egypt", "Smart Kids Supplies", "Delta Maintenance", "Al Amal Stationery", "Cool Air Services"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function wipeDemo(db: PostgresJsDatabase<any>) {
  await db.transaction(async (tx) => {
    const demo = sql`(select id from student where is_demo)`;
    const demoStaff = sql`(select id from staff where is_demo)`;
    // Money (Phase 4): demo invoices, payments, cash days, expenses and their approvals.
    const demoInv = sql`(select id from invoice where is_demo)`;
    const demoPay = sql`(select id from payment where is_demo)`;
    const demoExp = sql`(select id from expense where is_demo)`;
    const demoCn = sql`(select id from credit_note where is_demo or invoice_id in (select id from invoice where is_demo))`;
    const demoReq = sql`(select id from approval_request where expense_id in ${demoExp} or credit_note_id in ${demoCn})`;
    // Safety (Phase 5): demo incidents, issues and their alerts, before the children they point at.
    const demoIncident = sql`(select id from incident where is_demo or pickup_refusal_id in (select id from pickup_refusal where student_id in ${demo}))`;
    const demoAlert = sql`(select id from alert where is_demo or subject_id in ${demoIncident} or subject_id in (select id from issue where is_demo))`;
    // Closing (Phase 6): demo months are opened again so their lines can go; figures kept each night are rebuilt by the jobs.
    await tx.execute(sql`update period_close set status = 'open' where is_demo`);
    await tx.execute(sql`delete from balance_snapshot where is_demo`);
    await tx.execute(sql`delete from period_import_line where is_demo`);
    await tx.execute(sql`delete from import_batch b where kind = 'month_close' and file_name like '%(demo).xlsx' and not exists (select 1 from period_import_line l where l.batch_id = b.id)
      and not exists (select 1 from balance_snapshot s where s.batch_id = b.id)`);
    await tx.execute(sql`delete from period_close p where is_demo and not exists (select 1 from period_import_line l where l.period_close_id = p.id)`);
    await tx.execute(sql`delete from daily_close where is_demo`);
    await tx.execute(sql`delete from kpi_daily_snapshot`);
    await tx.execute(sql`delete from notification_delivery where notification_id in (select id from notification where alert_id in ${demoAlert})`);
    await tx.execute(sql`delete from notification where alert_id in ${demoAlert}`);
    await tx.execute(sql`delete from alert where id in ${demoAlert}`);
    await tx.execute(sql`delete from incident_file where incident_id in ${demoIncident}`);
    await tx.execute(sql`delete from incident_action where incident_id in ${demoIncident}`);
    await tx.execute(sql`delete from incident_person where incident_id in ${demoIncident} or student_id in ${demo}`);
    await tx.execute(sql`delete from incident where id in ${demoIncident}`);
    await tx.execute(sql`delete from issue where is_demo`);
    await tx.execute(sql`delete from payment_allocation where payment_id in ${demoPay} or invoice_id in ${demoInv}`);
    await tx.execute(sql`delete from approval_step where request_id in ${demoReq}`);
    await tx.execute(sql`delete from approval_request where id in ${demoReq}`);
    await tx.execute(sql`delete from credit_note where id in ${demoCn}`);
    await tx.execute(sql`update expense set cash_session_id = null where not is_demo and cash_session_id in (select id from cash_session where is_demo)`);
    await tx.execute(sql`delete from expense where is_demo`);
    await tx.execute(sql`delete from payment where is_demo`);
    await tx.execute(sql`delete from invoice_line where invoice_id in ${demoInv}`);
    await tx.execute(sql`delete from invoice where is_demo`);
    await tx.execute(sql`delete from cash_session where is_demo and not exists (select 1 from payment p where p.cash_session_id = cash_session.id)`);
    await tx.execute(sql`delete from price_lock where is_demo or student_id in ${demo}`);
    await tx.execute(sql`delete from student_service where student_id in ${demo}`);
    await tx.execute(sql`delete from fee_list_item where fee_list_id in (select id from fee_list where is_demo)`);
    await tx.execute(sql`delete from fee_list where is_demo`);
    await tx.execute(sql`delete from attachment where file_name = 'demo-receipt.png' and not exists (select 1 from expense e where e.receipt_attachment_id = attachment.id)`);
    await tx.execute(sql`delete from vendor where name in ${sql.raw(`(${DEMO_VENDOR_NAMES.map((n) => `'${n}'`).join(", ")})`)}
                         and not exists (select 1 from expense e where e.vendor_id = vendor.id)`);
    await tx.execute(sql`delete from doc_sequence where kind like '%\_demo'`);
    await tx.execute(sql`delete from student_attendance where student_id in ${demo}`);
    await tx.execute(sql`delete from pickup_refusal where student_id in ${demo}`);
    await tx.execute(sql`delete from ratio_snapshot where is_demo`);
    await tx.execute(sql`delete from room_roster where staff_id in ${demoStaff}`);
    await tx.execute(sql`delete from staff_attendance_day where staff_id in ${demoStaff}`);
    await tx.execute(sql`delete from staff_punch where is_demo or staff_id in ${demoStaff}`);
    await tx.execute(sql`delete from import_batch where kind = 'staff_punches' and file_name like 'demo-fingerprint-%'
                         and not exists (select 1 from staff_punch p where p.import_batch_id = import_batch.id)`);
    await tx.execute(sql`delete from staff where is_demo`);
    await tx.execute(sql`delete from consent_record where student_id in ${demo}`);
    await tx.execute(sql`delete from student_medical where student_id in ${demo}`);
    await tx.execute(sql`delete from student_guardian where student_id in ${demo}`);
    await tx.execute(sql`delete from enrollment where student_id in ${demo}`);
    await tx.execute(sql`delete from approval_request where student_id in ${demo}`);
    await tx.execute(sql`update waitlist_entry set converted_student_id = null where converted_student_id in ${demo}`);
    await tx.execute(sql`delete from student where is_demo`);
    await tx.execute(sql`delete from guardian where is_demo and not exists (select 1 from student_guardian sg where sg.guardian_id = guardian.id)`);
    await tx.execute(sql`delete from family where is_demo and not exists (select 1 from student s where s.family_id = family.id)
                         and not exists (select 1 from guardian g where g.family_id = family.id)`);
    await tx.execute(sql`delete from waitlist_entry where is_demo`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  await wipeDemo(drizzle(client));
  console.log("Demo children, families, waitlist, staff and attendance removed.");
  await client.end();
}
