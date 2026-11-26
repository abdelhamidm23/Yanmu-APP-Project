import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { ownerQuery, signInWithNewMfa } from "./helpers";

/**
 * Phase 7 main flow (spec §11.2–11.5, §17.1): the owner opens Home on demo data, reads the briefing and what
 * needs attention, switches branch, opens a figure's detail, asks the branches to call overdue families,
 * compares branches and downloads the monthly report.
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("the owner uses Home: briefing, attention, figures, details, comparison and reports", async ({ page }) => {
  execSync("pnpm -s seed:dev-users --reset", { stdio: "ignore" });
  await signInWithNewMfa(page, "owner@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/home$/);

  // Home: greeting, freshness, briefing (template sentences), attention list (at most 4 rows), figure groups.
  await expect(page.getByTestId("greeting")).toContainText("Owner");
  await expect(page.getByTestId("freshness")).toContainText("Days closed in");
  await expect(page.getByTestId("briefing")).toContainText("Written from today's records only");
  await expect(page.getByTestId("brief-critical")).toContainText("critical incident");
  const rows = page.getByTestId("attention-row");
  expect(await rows.count()).toBeGreaterThan(0);
  expect(await rows.count()).toBeLessThanOrEqual(4);
  await expect(rows.first()).toHaveAttribute("data-kind", "critical_incident");
  for (const g of ["money", "children", "team", "safety"]) await expect(page.getByTestId(`group-${g}`)).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);

  // One branch: every figure switches.
  await page.getByTestId("branch-tabs").getByRole("link", { name: "Yanmu" }).click();
  await expect(page).toHaveURL(/branch=/);
  await expect(page.getByTestId("tile-children_active")).toContainText("92");
  // The last month the accountant closed, Verified.
  await expect(page.getByTestId("tile-money_result")).toContainText("Verified");

  // Overdue tuition detail: ageing, longest overdue, export, ask the branches to call.
  await page.getByTestId("branch-tabs").getByRole("link", { name: "All branches" }).click();
  await expect(page).toHaveURL(/branch=all/);
  await page.getByTestId("tile-money_overdue").click();
  await expect(page.getByTestId("detail-money_overdue")).toBeVisible();
  await expect(page.getByTestId("ageing")).toContainText("60+");
  await expect(page.getByTestId("by-branch")).toContainText("Highest");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-overdue").click()]);
  expect(download.suggestedFilename()).toMatch(/^overdue-families-.*\.xlsx$/);
  await page.getByTestId("ask-call").click();
  await expect(page.locator("main [role=status]")).toContainText("follow-up issue");
  await ownerQuery((sql) => sql`delete from notification where alert_id in (select a.id from alert a join issue i on i.id = a.subject_id where i.title like '%Call overdue families%')`);
  await ownerQuery((sql) => sql`delete from alert where subject_id in (select id from issue where title like '%Call overdue families%')`);
  await ownerQuery((sql) => sql`delete from issue where title like '%Call overdue families%'`);

  // A figure with a 12-month trend and its formula.
  await page.goto("/en/home/money_billed");
  await expect(page.getByTestId("trend")).toContainText("Last 12 months");
  await expect(page.locator("main")).toContainText("How it is worked out");

  // Branch comparison: normalized figures, the better branch marked.
  await page.getByTestId("nav-branches").click();
  await expect(page.getByTestId("metric-occupancy")).toContainText("Better");
  expect(await noSideScroll(page)).toBe(true);

  // Reports: the monthly report in Excel.
  await page.getByTestId("nav-reports").click();
  const [report] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-monthly").click()]);
  expect(report.suggestedFilename()).toMatch(/^monthly-report-\d{4}-\d{2}\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(await readFile((await report.path())!)).slice().buffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Figures", "Comparison", "Attention"]);
  expect(wb.worksheets[0].rowCount).toBeGreaterThan(20);

  // Inbox: "Needs me" and "All".
  await page.goto("/en/inbox");
  await expect(page.getByTestId("inbox-filter")).toBeVisible();
  await expect(page.getByTestId("attention")).toBeVisible();

  // Arabic, right to left.
  await page.goto("/ar/home");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("briefing")).toContainText("مكتوب من سجلات اليوم فقط");
  expect(await noSideScroll(page)).toBe(true);
});
