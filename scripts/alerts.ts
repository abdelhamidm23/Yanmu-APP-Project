/**
 * The alert job (spec §10), for servers that run it outside the app (ALERTS_TICK=off). Schedule it
 * every minute, for example from cron:
 *
 *   * * * * *  cd /app && pnpm alerts
 *
 * It connects as the app (DATABASE_URL) without a signed-in person, which is what the database's
 * alert functions require.
 */
import "dotenv/config";
import { runAlertTick } from "../src/lib/alert-job";
import { pgClient } from "../src/db";

runAlertTick()
  .then((r) => console.log(`alerts: ${r.raised} notified, ${r.sent} sent`))
  .catch(() => {
    console.error("alert job failed");
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
