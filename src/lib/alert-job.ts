import { sql } from "drizzle-orm";
import { db } from "../db";
import { alertText } from "./alert-text";
import { notifiers, type PushTarget } from "./notifier";

type Due = {
  id: string; channel: "push" | "sms"; user_id: string; locale: string; phone: string | null; alert_key: string; tier: string;
  branch_ar: string; branch_en: string; subscriptions: PushTarget[];
};

let running = false;

/**
 * One run of the alert job (spec §10): the database works out what is due (escalations, critical
 * repeats, time-of-day alerts), then this sends the pushes and SMS and records the result.
 * Runs without a signed-in person (app.user_id empty), which the database functions require.
 */
export async function runAlertTick(): Promise<{ raised: number; sent: number }> {
  if (running) return { raised: 0, sent: 0 };
  running = true;
  try {
    const [{ n }] = (await db.transaction((tx) => tx.execute(sql`select app_run_alerts() as n`))) as unknown as { n: number }[];
    const sent = await sendDueDeliveries();
    return { raised: n, sent };
  } finally {
    running = false;
  }
}

/** Sends what is due now. Also called straight after a critical incident is logged, so nobody waits a minute. */
export async function sendDueDeliveries(limit = 200): Promise<number> {
  const due = (await db.transaction((tx) => tx.execute(sql`select * from app_claim_deliveries(${limit})`))) as unknown as Due[];
  if (due.length === 0) return 0;
  const n = notifiers();
  let sent = 0;
  for (const d of due) {
    const text = alertText(d.alert_key, d.locale, { ar: d.branch_ar, en: d.branch_en });
    const message = { ...text, url: `/${d.locale === "en" ? "en" : "ar"}/inbox`, critical: d.tier === "critical" };
    let result;
    try {
      result = await n[d.channel].send({ phone: d.phone, subscriptions: d.subscriptions ?? [] }, message);
    } catch {
      result = { status: "failed" as const, detail: "error" };
    }
    if (result.status === "sent") sent++;
    await db.transaction((tx) =>
      tx.execute(sql`select app_delivery_done(${d.id}, ${result.status}, ${result.detail}, ${sql.raw(arrayLiteral(result.gone ?? []))})`),
    );
  }
  return sent;
}

function arrayLiteral(items: string[]): string {
  return `ARRAY[${items.map((s) => `'${s.replace(/'/g, "''")}'`).join(", ")}]::text[]`;
}

/** Fire-and-forget after a write that raised an alert. Errors are only logged without details (rule 9). */
export function sendSoon() {
  setTimeout(() => {
    sendDueDeliveries().catch(() => console.error("alert send failed"));
  }, 0);
}
