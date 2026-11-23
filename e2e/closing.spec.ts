import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { execSync } from "node:child_process";
import { ownerQuery, signIn, signInWithNewMfa } from "./helpers";

/**
 * Phase 6 main flows (spec §8.9, §8.10): a branch manager closes a day, section by section; the
 * accountant downloads the month-close template, fills it in, sees a row error, fixes it, uploads it
 * and closes the month. Uses the demo (pnpm seed:demo); both are undone afterwards.
 */
test.describe.configure({ timeout: 180_000 });

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const lastMonth = (() => {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
})();

async function undoMonth(branchId: string) {
  await ownerQuery(async (sql) => {
    await sql`update period_close set status = 'open', closed_at = null, closed_by = null where branch_id = ${branchId} and month = ${`${lastMonth}-01`}`;
    await sql`delete from balance_snapshot where branch_id = ${branchId} and month = ${`${lastMonth}-01`}`;
    await sql`delete from period_import_line where period_close_id in (select id from period_close where branch_id = ${branchId} and month = ${`${lastMonth}-01`})`;
    await sql`delete from import_batch where branch_id = ${branchId} and kind = 'month_close' and file_name like ${`${lastMonth} %`}`;
    return [];
  });
}

test("the branch manager closes a day, one tap per section", async ({ page }) => {
  const [b] = await ownerQuery((sql) => sql`select id from branch where code = 'B'`);
  const [{ d }] = await ownerQuery(
    (sql) => sql`select to_char(max(d::date), 'YYYY-MM-DD') as d from generate_series(${today}::date - 10, ${today}::date - 1, interval '1 day') d
                 where is_working_day(${b.id}, d::date)`,
  );
  await ownerQuery((sql) => sql`delete from daily_close where branch_id = ${b.id} and date = ${d}`);

  await signIn(page, "branch.manager.b@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/today/);
  await page.goto(`/en/daily-close?branch=${b.id}&date=${d}`);
  await expect(page.getByTestId("close-day-form")).toBeVisible();
  for (const s of ["attendance", "pickups", "staff", "payments", "expenses", "incidents", "issues"]) await page.getByTestId(`ok-${s}`).check();
  // "To fix" needs a word on what is wrong.
  await page.getByTestId("fix-staff").check();
  await page.getByTestId("submit-close").click();
  await expect(page.locator("main [role=alert]")).toContainText("write what needs fixing");
  for (const s of ["attendance", "pickups", "payments", "expenses", "incidents", "issues"]) await page.getByTestId(`ok-${s}`).check();
  await page.getByTestId("fix-staff").check();
  await page.locator("#n-staff").fill("Two morning punches missing");
  await page.getByTestId("submit-close").click();
  await expect(page.locator("main [role=status]")).toHaveText("The day is closed. Thank you.");
  await expect(page.getByTestId("day-closed")).toContainText("Two morning punches missing");
  await expect(page.getByTestId("day-status")).toContainText("Closed by");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Closed late (after the evening deadline of that day).
  await expect(page.getByTestId("day-status")).toContainText("Closed late");
  await ownerQuery((sql) => sql`delete from daily_close where branch_id = ${b.id} and date = ${d} and not is_demo`);
});

test("the accountant imports the month-close template and closes the month", async ({ page }) => {
  const [a] = await ownerQuery((sql) => sql`select id from branch where code = 'A'`);
  await undoMonth(a.id);
  execSync("pnpm -s seed:dev-users --reset", { stdio: "ignore" });
  await signInWithNewMfa(page, "accountant@yanmu.test", "en");
  try {
    await page.goto(`/en/month-close?branch=${a.id}&month=${lastMonth}`);
    await expect(page.getByTestId("month-status")).toContainText("Provisional");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-template").click()]);
    const wb = new ExcelJS.Workbook();
    const bytes = await (await import("node:fs/promises")).readFile((await download.path())!);
    await wb.xlsx.load(new Uint8Array(bytes).slice().buffer);
    const ws = wb.worksheets[0];
    let collectedRow = 0;
    ws.eachRow((row, r) => {
      const code = String(row.getCell(1).value);
      if (code === "check:collected") collectedRow = r;
      if (code === "central:salaries") row.getCell(4).value = 214500;
      if (code === "balance:cash") row.getCell(4).value = "18,450.00";
    });
    const app = String(ws.getRow(collectedRow).getCell(3).value);
    // A difference without a note is a row error; nothing is saved.
    ws.getRow(collectedRow).getCell(4).value = (Number(app) - 100).toFixed(2);
    const file = async () => ({ name: `${lastMonth} month-close A.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await wb.xlsx.writeBuffer()) });
    await page.getByTestId("month-file").setInputFiles(await file());
    await page.getByTestId("month-check").click();
    await expect(page.getByTestId("month-errors")).toContainText(`Row ${collectedRow}`);
    await expect(page.getByTestId("month-errors")).toContainText("write a note");

    ws.getRow(collectedRow).getCell(5).value = "EGP 100 cash counted short on the 30th";
    await page.getByTestId("month-file").setInputFiles(await file());
    await page.getByTestId("month-check").click();
    await expect(page.getByTestId("month-preview")).toContainText("lines are ready");
    await page.getByTestId("month-commit").click();
    await expect(page.getByTestId("month-import-done")).toBeVisible();

    await page.goto(`/en/month-close?branch=${a.id}&month=${lastMonth}`);
    await expect(page.getByTestId("month-lines")).toContainText("1 line differs from the app");
    await expect(page.getByTestId("month-lines")).toContainText("EGP 100 cash counted short");
    await page.getByTestId("close-month").click();
    await expect(page.locator("main [role=status]")).toContainText("The month is closed");
    await expect(page.getByTestId("month-status")).toContainText("Verified");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await undoMonth(a.id);
  }
});
