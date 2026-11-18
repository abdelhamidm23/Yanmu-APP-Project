/**
 * Start command for the online demo (deploy/huggingface, render.yaml). Not used in development or production.
 *
 * 1. Takes the database owner's connection string (MIGRATION_DATABASE_URL, pasted once when
 *    the preview is created) and derives the app's own login (yanmu_app) from it.
 * 2. Applies migrations, base data and the demo accounts. Demo accounts are reset on every
 *    start, so a forgotten password or a two-step setup by someone else never locks anyone out.
 * 3. Starts the app.
 */
import { execSync, spawn } from "node:child_process";

if (process.env.DEMO_MODE !== "true") {
  console.error("preview-start is only for the online demo (DEMO_MODE=true).");
  process.exit(1);
}

function clean(raw) {
  const u = new URL(raw);
  u.searchParams.delete("channel_binding"); // not understood by the Postgres client
  u.hostname = u.hostname.replace("-pooler.", "."); // Neon: use the direct connection, not the pooler
  if (!u.searchParams.has("sslmode")) u.searchParams.set("sslmode", "require");
  return u;
}

const owner = clean(process.env.MIGRATION_DATABASE_URL ?? "");
const appPassword = process.env.APP_DB_PASSWORD;
if (!appPassword) throw new Error("APP_DB_PASSWORD is not set");
const app = new URL(owner);
app.username = "yanmu_app";
app.password = appPassword;

const env = {
  ...process.env,
  MIGRATION_DATABASE_URL: owner.toString(),
  DATABASE_URL: app.toString(),
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000",
  NEXT_TELEMETRY_DISABLED: "1",
};

for (const cmd of ["pnpm -s db:migrate", "pnpm -s seed:base", "pnpm -s seed:dev-users --reset", "pnpm -s seed:demo"]) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", env });
}

const server = spawn("pnpm", ["start"], { stdio: "inherit", env });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.kill(sig));
server.on("exit", (code) => process.exit(code ?? 0));
