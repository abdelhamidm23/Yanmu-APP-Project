/**
 * Removes every demo child, family, guardian, enrollment and waitlist entry (spec §16).
 * Rooms stay: they are settings, and the owner may have renamed them.
 * Usage: pnpm seed:wipe-demo
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { fileURLToPath } from "node:url";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function wipeDemo(db: PostgresJsDatabase<any>) {
  await db.transaction(async (tx) => {
    const demo = sql`(select id from student where is_demo)`;
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
  console.log("Demo children, families and waitlist removed.");
  await client.end();
}
