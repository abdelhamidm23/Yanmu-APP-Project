import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { ownerQuery, signIn, signInWithNewMfa } from "./helpers";

/**
 * Phase 4 main flows (spec §8.4 to §8.6): a cash payment with its receipt, an unusual expense going
 * to approval and being approved, and the monthly invoice run. Uses the demo money (pnpm seed:demo).
 */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const nextMonth = (() => {
  const [y, m] = today.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
})();

test("front desk records a cash payment and gets a numbered receipt", async ({ page }) => {
  await signIn(page, "front.desk@yanmu.test", "en");
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/en/payment");
  await page.getByTestId("family-results").getByRole("link").first().click();
  await expect(page.getByTestId("family-owes")).toBeVisible();
  await page.locator("#pay-amount").fill("100");
  await page.locator("#pay-method").selectOption("cash");
  await page.getByTestId("record-payment").click();

  await expect(page).toHaveURL(/\/en\/payments\/[0-9a-f-]+/);
  await expect(page.locator("main [role=status]")).toHaveText("Payment recorded. The receipt is below.");
  await expect(page.getByTestId("receipt-no")).toContainText(/A-R\d{4}-\d{5}/);
  await expect(page.getByTestId("receipt-amount")).toContainText("100");
  // The person who recorded it cannot void it (a second person must).
  await expect(page.getByTestId("void-payment")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("an unusual expense waits for approval and the company manager approves it", async ({ page, browser }) => {
  const desc = `E2E printer ink ${Date.now()}`;
  // Resetting the test accounts signs everyone out, so do it before anyone signs in.
  execSync("pnpm -s seed:dev-users --reset", { stdio: "ignore" });
  await signIn(page, "branch.manager@yanmu.test", "en");
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/en/expenses/new");
  const form = page.getByTestId("expense-form");
  await form.locator("#exp-category").selectOption({ index: 1 });
  await form.locator("#exp-amount").fill("50");
  await form.locator("#exp-method").selectOption("card");
  await form.locator("#exp-desc").fill(desc);
  await form.locator("#exp-flag").fill("Bought from a new shop");
  await page.getByTestId("save-expense").click();
  await expect(page.locator("main [role=status]")).toHaveText("Expense saved and sent for approval, because it is not routine.");
  await expect(page.getByTestId("expense")).toContainText("Waiting for approval");

  const ctx = await browser.newContext();
  const cm = await ctx.newPage();
  await signInWithNewMfa(cm, "company.manager@yanmu.test", "en");
  await cm.goto("/en/inbox");
  const item = cm.getByTestId("inbox-item").filter({ hasText: desc });
  await expect(item).toContainText("Marked unusual by the person");
  await item.getByTestId("approve").click();
  await expect(cm.locator("main [role=status]")).toHaveText("Approved.");
  await expect(cm.getByTestId("inbox-item").filter({ hasText: desc })).toHaveCount(0);
  await ctx.close();

  await page.reload();
  await expect(page.getByTestId("expense")).toContainText("Approved");
});

test("the accountant previews next month's invoices and issues them", async ({ page }) => {
  const clear = () =>
    ownerQuery(async (sql) => {
      const inv = sql`(select i.id from invoice i join branch b on b.id = i.branch_id where b.code = 'A' and i.service_month = ${nextMonth} and i.kind = 'tuition')`;
      await sql`delete from invoice_line where invoice_id in ${inv}`;
      await sql`delete from invoice where id in ${inv}`;
      return [];
    });
  await clear();
  try {
    execSync("pnpm -s seed:dev-users --reset", { stdio: "ignore" });
    await signInWithNewMfa(page, "accountant@yanmu.test", "en");
    await page.goto(`/en/invoices/run?month=${nextMonth}`);
    await expect(page.getByTestId("run-summary")).toContainText(/[1-9]\d* to issue · 0 already issued/);
    await page.getByTestId("post-run").click();
    await expect(page.locator("main [role=status]")).toHaveText("Invoices issued.");
    await expect(page.getByTestId("run-summary")).toContainText(/^0 to issue · [1-9]\d* already issued/);
    await expect(page.getByTestId("post-run")).toHaveCount(0);
  } finally {
    await clear();
  }
});

test("every money screen opens for the owner in Arabic and English", async ({ page }) => {
  const [ids] = await ownerQuery(
    (sql) => sql`
      select
        (select i.id from invoice i join branch b on b.id = i.branch_id where b.code = 'A' and i.kind = 'late_fee' limit 1) as invoice,
        (select p.id from payment p join branch b on b.id = p.branch_id where b.code = 'A' and p.voided_at is not null limit 1) as payment,
        (select e.id from expense e join branch b on b.id = e.branch_id where b.code = 'A' limit 1) as expense,
        (select s.id from student s join branch b on b.id = s.branch_id where b.code = 'A' and s.status = 'active' limit 1) as child`,
  );
  execSync("pnpm -s seed:dev-users --reset", { stdio: "ignore" });
  await signInWithNewMfa(page, "owner@yanmu.test", "en");
  const paths = [
    "/money", "/invoices", "/invoices?view=overdue", "/invoices?view=late-today", "/invoices?view=all", "/invoices/run",
    `/invoices/${ids.invoice}`, "/payment", "/payments", `/payments/${ids.payment}`, "/cash-box", "/expenses", "/expenses/new",
    `/expenses/${ids.expense}`, "/inbox", "/settings/fees", "/settings/price-locks", "/settings/expenses", `/children/${ids.child}`,
    "/today", "/more", "/settings",
  ];
  for (const locale of ["en", "ar"]) {
    for (const path of paths) {
      await page.goto(`/${locale}${path}`);
      await expect(page.locator("h1").first(), `${locale}${path}`).toBeVisible();
      await expect(page.getByRole("heading", { name: /^(Something went wrong|حدث خطأ)/ }), `${locale}${path}`).toHaveCount(0);
      // No untranslated message keys (next-intl shows the key path when one is missing).
      expect(await page.locator("main").innerText(), `${locale}${path}`).not.toMatch(/\bmoney\.[a-zA-Z]+\.[a-zA-Z]/);
    }
  }
});
