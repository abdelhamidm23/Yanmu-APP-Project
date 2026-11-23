/**
 * Scheduled money jobs (spec §8.4.1, §8.4.4). Run it every night at 00:30 Cairo time and again in the
 * morning after `billing.preview_until` (default 09:00), for example from cron:
 *
 *   30 0 * * *  cd /app && pnpm jobs
 *   5 9 * * *   cd /app && pnpm jobs
 *
 * What it does, for every branch:
 *   1. Late fees: one line per working day for each tuition invoice still unpaid after its due date.
 *      Safe to run any number of times: a day already charged is skipped.
 *   2. Invoice run: from `billing.invoice_day` (default the 1st) once the preview time has passed,
 *      issues this month's tuition invoices for children not invoiced yet. Children who start later
 *      in the month are picked up by the next run, pro-rated by working days.
 *   3. Figures: keeps yesterday's and today's figures of every branch (kpi_daily_snapshot, spec §7.7),
 *      so a trend never changes after the fact. Running it again updates today's row.
 *
 * It connects with the owner connection (MIGRATION_DATABASE_URL), so it writes as "the system":
 * no person is recorded as having made these rows.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { accrueLateFees, postInvoiceRun } from "../src/db/billing";
import { cairoTimeOf, minutesOf, todayInCairo } from "../src/lib/calendar";
import { monthStart } from "../src/lib/billing";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");
const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });

async function setting<T>(branchId: string, key: string, fallback: T): Promise<T> {
  const rows = (await db.execute(sql`select app_setting(${branchId}::uuid, ${key}) as v`)) as unknown as { v: T | null }[];
  return rows[0]?.v ?? fallback;
}

export async function runJobs(now = new Date()) {
  const today = todayInCairo(now);
  const time = minutesOf(cairoTimeOf(now));
  const branches = await db.select({ id: schema.branch.id, code: schema.branch.code }).from(schema.branch);
  for (const b of branches) {
    const invoiceDay = Number(await setting(b.id, "billing.invoice_day", 1));
    const previewUntil = String(await setting(b.id, "billing.preview_until", "09:00"));
    let issued = 0;
    if (Number(today.slice(8)) >= invoiceDay && time >= minutesOf(previewUntil)) {
      issued = await db.transaction((tx) => postInvoiceRun(tx, b.id, monthStart(today), today));
    }
    const lateLines = await db.transaction((tx) => accrueLateFees(tx, b.id, today));
    console.log(`${b.code}: ${issued} invoices issued, ${lateLines} late-fee days added (${today})`);
  }
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  let kept = 0;
  for (const d of [yesterday, today]) {
    const [r] = (await db.execute(sql`select app_snapshot_kpis(${d}::date) as n`)) as unknown as { n: number }[];
    kept += Number(r?.n ?? 0);
  }
  console.log(`figures kept: ${kept} (${yesterday}, ${today})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runJobs()
    .then(() => client.end())
    .catch(async (e) => {
      console.error("jobs failed:", e instanceof Error ? e.message : "unknown error");
      await client.end();
      process.exit(1);
    });
}
