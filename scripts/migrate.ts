/**
 * Applies SQL migrations from ./drizzle as the database owner, then lets the
 * app's own role (yanmu_app, created by the migrations) log in.
 *
 * Usage: pnpm db:migrate
 * Needs MIGRATION_DATABASE_URL (owner) and APP_DB_PASSWORD (password for yanmu_app).
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");

const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });

const appPassword = process.env.APP_DB_PASSWORD;
if (appPassword) {
  await client.unsafe(`ALTER ROLE yanmu_app LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}'`);
  console.log("App database role can log in.");
} else {
  console.warn("APP_DB_PASSWORD is not set: the app role yanmu_app cannot log in yet.");
}
await client.end();
console.log("Migrations applied.");
