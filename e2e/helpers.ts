import { expect, type Page } from "@playwright/test";
import { generateSync } from "otplib";

export const PASSWORD = process.env.DEV_USER_PASSWORD ?? "Yanmu-dev-2026!";

export async function signIn(page: Page, email: string, locale: "ar" | "en" = "ar") {
  await page.goto(`/${locale}/login`);
  // The dev server compiles on first visit; submitting before React is ready would post a plain form.
  await page.waitForLoadState("networkidle");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
}

export function totp(secret: string) {
  return generateSync({ secret });
}

export async function expectDirection(page: Page, lang: "ar" | "en") {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

/** Signs in a privileged user who has no MFA yet and turns it on. Returns the TOTP secret. */
export async function signInWithNewMfa(page: Page, email: string, locale: "ar" | "en" = "en") {
  await signIn(page, email, locale);
  await expect(page).toHaveURL(new RegExp(`/${locale}/setup-mfa$`));
  await page.locator("#password").fill(PASSWORD);
  await page.getByTestId("mfa-start").click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.locator("#code").fill(totp(secret));
  await page.getByTestId("mfa-confirm").click();
  await page.getByTestId("mfa-done").click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/home$`));
  return secret;
}

/**
 * Children tests: removes children the tests added (names start "E2E"), puts the demo children
 * back (Branch A 92, Branch B 61, waitlist 9) and the licence back to 100.
 */
export async function resetChildren() {
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const kids = sql`(select id from student where full_name_en like 'E2E %')`;
    await sql`delete from consent_record where student_id in ${kids}`;
    await sql`delete from student_medical where student_id in ${kids}`;
    await sql`delete from student_guardian where student_id in ${kids}`;
    await sql`delete from enrollment where student_id in ${kids}`;
    await sql`delete from approval_request where student_id in ${kids}`;
    await sql`update waitlist_entry set converted_student_id = null where converted_student_id in ${kids}`;
    await sql`delete from student where full_name_en like 'E2E %'`;
    await sql`delete from guardian where full_name like 'E2E %' and not exists (select 1 from student_guardian sg where sg.guardian_id = guardian.id)`;
    await sql`delete from family where display_name like 'E2E %' and not exists (select 1 from student s where s.family_id = family.id)
              and not exists (select 1 from guardian g where g.family_id = family.id)`;
    await sql`update branch set licensed_capacity = 100 where code in ('A', 'B')`;
  } finally {
    await sql.end();
  }
  const { execSync } = await import("node:child_process");
  execSync("pnpm -s seed:demo --reset", { stdio: "ignore" });
}

/** Runs one query as the database owner (test setup only). */
export async function ownerQuery<T extends Record<string, unknown>>(query: (sql: import("postgres").Sql) => Promise<T[]>): Promise<T[]> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return await query(sql);
  } finally {
    await sql.end();
  }
}
