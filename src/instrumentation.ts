/**
 * Starts the alert job inside the app server (spec §10): every minute it moves unhandled alerts to
 * the next person, repeats critical alerts until someone acknowledges, and sends pushes and SMS.
 * Set ALERTS_TICK=off to run it elsewhere instead (`pnpm alerts`, for example from cron every minute).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.ALERTS_TICK === "off") return;
  const g = globalThis as unknown as { alertTimer?: ReturnType<typeof setInterval> };
  if (g.alertTimer) return;
  const { runAlertTick } = await import("./lib/alert-job");
  const tick = () => runAlertTick().catch(() => console.error("alert job failed"));
  g.alertTimer = setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
}
