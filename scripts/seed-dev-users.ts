/**
 * Creates one test account per role for development and automated tests.
 * DEVELOPMENT ONLY — refuses to run when NODE_ENV=production.
 *
 * Usage: pnpm seed:dev-users            (keeps existing accounts as they are)
 *        pnpm seed:dev-users --reset    (also turns MFA off again, for repeatable tests)
 */
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hashPassword } from "better-auth/crypto";
import * as schema from "../src/db/schema";
import { DEMO_ACCOUNTS } from "../src/lib/demo";

if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "true") {
  console.error("Refusing to seed test accounts in production (only allowed when DEMO_MODE=true).");
  process.exit(1);
}

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");
const password = process.env.DEV_USER_PASSWORD ?? "Yanmu-dev-2026!";
const reset = process.argv.includes("--reset");

export const DEV_USERS = DEMO_ACCOUNTS;

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });
const hash = await hashPassword(password);

const branchRows = await db.select({ id: schema.branch.id, code: schema.branch.code }).from(schema.branch);
const branchId = (code: "A" | "B" | null) => {
  if (code === null) return null;
  const b = branchRows.find((r) => r.code === code);
  if (!b) throw new Error(`Branch ${code} not found. Run pnpm seed:base first.`);
  return b.id;
};

for (const u of DEV_USERS) {
  const [existing] = await db.select().from(schema.appUser).where(eq(schema.appUser.email, u.email));
  let userId = existing?.id;
  if (!userId) {
    const [created] = await db
      .insert(schema.appUser)
      .values({ email: u.email, name: u.name, locale: u.locale, emailVerified: true })
      .returning({ id: schema.appUser.id });
    userId = created.id;
    await db.insert(schema.authAccount).values({ userId, accountId: userId, providerId: "credential", password: hash });
  } else if (reset) {
    await db.update(schema.appUser).set({ twoFactorEnabled: false, locale: u.locale, digits: "latin", endDate: null }).where(eq(schema.appUser.id, userId));
    await db.delete(schema.authTwoFactor).where(eq(schema.authTwoFactor.userId, userId));
    await db.delete(schema.authSession).where(eq(schema.authSession.userId, userId));
    await db.update(schema.authAccount).set({ password: hash }).where(eq(schema.authAccount.userId, userId));
  }
  await db.delete(schema.userBranchRole).where(eq(schema.userBranchRole.userId, userId));
  await db.insert(schema.userBranchRole).values(u.roles.map(([role, code]) => ({ userId: userId!, role, branchId: branchId(code) })));
}

const count = await db.select({ id: schema.appUser.id }).from(schema.appUser).where(inArray(schema.appUser.email, DEV_USERS.map((u) => u.email)));
console.log(`Test accounts ready: ${count.length}. Password for all: the DEV_USER_PASSWORD in your .env file.`);
await client.end();
