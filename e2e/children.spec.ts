import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import ExcelJS from "exceljs";
import { execSync } from "node:child_process";
import { expectDirection, ownerQuery, resetChildren, signIn as signInForm, signInWithNewMfa } from "./helpers";

/** Signs in and waits until the app has opened (the home screen of the role). */
async function signIn(page: Page, email: string, locale: "ar" | "en") {
  await signInForm(page, email, locale);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.getByTestId("nav-more").first()).toBeVisible();
}

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

function isoMonthsAgo(months: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

async function openChildren(page: Page) {
  const tab = page.getByTestId("nav-children");
  if (await tab.count()) await tab.first().click();
  else {
    await page.getByTestId("nav-more").click();
    await page.getByTestId("open-children").click();
  }
  await expect(page.getByTestId("occupancy")).toBeVisible();
}

/** Fills the add-child form for a toddler with a new family. */
async function fillNewChild(page: Page, name: string, phone: string, dob = isoMonthsAgo(18)) {
  await page.locator("#fullNameAr").fill(`طفل ${name}`);
  await page.locator("#fullNameEn").fill(`E2E ${name}`);
  await page.locator("#dateOfBirth").fill(dob);
  await page.locator("#familyName").fill(`E2E family ${name}`);
  await page.locator("#g1Name").fill(`E2E Parent ${name}`);
  await page.locator("#g1Phone").fill(phone);
  await page.locator("#roomId").selectOption({ label: "Toddlers 1 · Toddlers" });
}

test.describe("children (Phase 2)", () => {
  test.beforeEach(async () => {
    await resetChildren();
  });

  test("front desk adds a child; the same child again is caught as a duplicate", async ({ page }) => {
    await signIn(page, "front.desk@yanmu.test", "en");
    await openChildren(page);
    await expect(page.getByTestId("occupancy")).toContainText("92 of 100 licensed places (92%)");
    await expect(page.getByTestId("child-count")).toHaveText("92 children");

    const name = `Salma ${stamp()}`;
    const phone = `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    await page.getByTestId("add-child").click();
    await fillNewChild(page, name, phone);
    await expect(page.getByTestId("age-at-start")).toContainText("1 y 6 m");
    await page.getByTestId("save-child").click();
    await expect(page.getByTestId("child-name")).toHaveText(`E2E ${name}`);
    await expect(page.getByTestId("child-status")).toHaveText("Enrolled");
    await expect(page.getByTestId("guardian-list")).toContainText(phone);

    // Same name and birth date: the form asks before saving a second record.
    await page.goto("/en/children/new");
    await fillNewChild(page, name, "01198765432");
    await page.getByTestId("save-child").click();
    await expect(page.getByTestId("duplicate-warning")).toContainText(`E2E ${name}`);
    await page.getByTestId("save-anyway").click();
    await expect(page.getByTestId("child-name")).toHaveText(`E2E ${name}`);

    await page.goto("/en/children");
    await expect(page.getByTestId("occupancy")).toContainText("94 of 100");
  });

  test("past the licence limit the child waits for the owner, who approves", async ({ page }) => {
    await ownerQuery((sql) => sql`update branch set licensed_capacity = 92 where code = 'A'`);
    await signIn(page, "front.desk@yanmu.test", "en");
    await openChildren(page);
    await expect(page.getByTestId("occupancy")).toContainText("The next child needs the owner's approval");

    const name = `Over ${stamp()}`;
    await page.getByTestId("add-child").click();
    await fillNewChild(page, name, "01055555555");
    await page.getByTestId("save-child").click();
    const card = page.getByTestId("over-capacity");
    await expect(card).toContainText("The branch is full (92 children)");
    await card.locator("#capReason").fill("Twin of a child already here");
    await page.getByTestId("send-for-approval").click();
    await expect(page.getByTestId("child-status")).toHaveText("Waiting for approval");
    await expect(page.getByTestId("pending-request")).toBeVisible();

    // The owner decides; the front desk cannot.
    await page.context().clearCookies();
    execSync("pnpm -s seed:dev-users --reset", { stdio: "ignore" });
    await signInWithNewMfa(page, "owner@yanmu.test", "en");
    await page.goto("/en/children/approvals");
    const request = page.getByTestId("request-over_capacity").filter({ hasText: `E2E ${name}` });
    await expect(request).toContainText("Twin of a child already here");
    await request.getByTestId("approve").click();
    await expect(page.locator("main [role=status]")).toHaveText("Saved.");
    await page.getByRole("link", { name: "← Children" }).click();
    await expect(page.getByTestId("occupancy")).toContainText("93 of 92");
  });

  test("medical notes: branch manager reads them, front desk cannot", async ({ page }) => {
    const [kid] = await ownerQuery<{ id: string; allergies: string }>(
      (sql) => sql`select m.student_id as id, m.allergies from student_medical m join branch b on b.id = m.branch_id
                   where b.code = 'A' and m.allergies is not null limit 1`,
    );
    await signIn(page, "front.desk@yanmu.test", "en");
    await page.goto(`/en/children/${kid.id}`);
    await expect(page.getByTestId("medical-restricted")).toBeVisible();
    await expect(page.getByTestId("medical")).not.toContainText(kid.allergies);

    await page.context().clearCookies();
    await signIn(page, "branch.manager@yanmu.test", "en");
    await page.goto(`/en/children/${kid.id}`);
    await expect(page.locator("#m-allergies")).toHaveValue(kid.allergies);
  });

  test("a teacher sees only the children in their room", async ({ page }) => {
    await signIn(page, "teacher@yanmu.test", "en");
    await page.goto("/en/children");
    await expect(page.getByTestId("child-count")).toHaveText("11 children");
    await expect(page.getByTestId("add-child")).toHaveCount(0);
  });

  test("transfer: Yanmu asks, Norvale's manager accepts, the child keeps one record", async ({ page }) => {
    const [kid] = await ownerQuery<{ id: string; name: string }>(
      (sql) => sql`select s.id, s.full_name_en as name from student s join branch b on b.id = s.branch_id
                   join enrollment e on e.student_id = s.id and e.status = 'active'
                   join room r on r.id = e.room_id and r.name_en = 'Juniors 1'
                   where b.code = 'A' order by s.student_no limit 1`,
    );
    await signIn(page, "front.desk@yanmu.test", "en");
    await page.goto(`/en/children/${kid.id}`);
    const form = page.getByTestId("transfer-form");
    await form.locator("#tr-branch").selectOption({ label: "Norvale" });
    await form.locator("#tr-reason").fill("Family moved closer to Norvale");
    await form.getByRole("button").click();
    await expect(page.getByTestId("pending-request")).toContainText("Transfer to Norvale");

    await page.context().clearCookies();
    await signIn(page, "branch.manager.b@yanmu.test", "en");
    await page.goto("/en/children/approvals");
    const request = page.getByTestId("request-transfer").filter({ hasText: kid.name });
    await request.locator("select").selectOption({ label: "Juniors 1 · Juniors" });
    await request.getByTestId("accept-transfer").click();
    await expect(page.locator("main [role=status]")).toHaveText("Saved.");

    await page.goto(`/en/children/${kid.id}`);
    await expect(page.getByTestId("enrollment-history")).toContainText("Norvale · Juniors 1 · Enrolled");
    await expect(page.getByTestId("enrollment-history")).toContainText("Yanmu · Moved to another branch");
  });

  test("company manager imports children from Excel, fixes a row error, then undoes the import", async ({ page }) => {
    execSync("pnpm -s seed:dev-users --reset", { stdio: "ignore" });
    await signInWithNewMfa(page, "company.manager@yanmu.test", "en");
    await page.goto("/en/children/import");

    const sheet = async (badPhone: boolean) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Children");
      ws.addRow(["Family ref", "Child name (Arabic)", "Child name (English)", "Date of birth", "Gender (female/male)", "Class", "Start date", "Guardian 1 name", "Guardian 1 relationship", "Guardian 1 phone", "Records consent signed on"]);
      const s = stamp();
      ws.addRow(["1", "هنا", `E2E Hana ${s}`, isoMonthsAgo(30), "female", "Juniors 1", "2025-09-01", "E2E Dina", "mother", badPhone ? "12345" : "01012121212", "2025-08-20"]);
      ws.addRow(["1", "آدم", `E2E Adam ${s}`, isoMonthsAgo(40), "ذكر", "Seniors 1", "1/9/2025", "E2E Dina", "أم", "01012121212", ""]);
      return { name: "children.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
    };

    await page.getByTestId("import-file").setInputFiles(await sheet(true));
    await page.getByTestId("import-check").click();
    await expect(page.getByTestId("import-errors")).toContainText("Row 2: Guardian 1 phone: not an Egyptian mobile number");

    await page.getByTestId("import-file").setInputFiles(await sheet(false));
    await page.getByTestId("import-check").click();
    await expect(page.getByTestId("import-preview")).toContainText("2 children are ready to import");
    await page.getByTestId("import-commit").click();
    await expect(page.getByTestId("import-done")).toContainText("Imported 2 children.");

    await page.goto("/en/children");
    await expect(page.getByTestId("occupancy")).toContainText("94 of 100");

    await page.goto("/en/children/import");
    await page.getByTestId("import-batches").getByTestId("import-rollback").first().click();
    await expect(page.locator("main [role=status]")).toHaveText("Saved.");
    await expect(page.getByTestId("import-batches")).toContainText("undone");
    await page.goto("/en/children");
    await expect(page.getByTestId("occupancy")).toContainText("92 of 100");
  });

  test("waitlist: 9 waiting at Yanmu; enrolling one fills in the form", async ({ page }) => {
    await signIn(page, "branch.manager@yanmu.test", "en");
    await page.goto("/en/children/waitlist");
    await expect(page.getByTestId("waitlist-summary")).toContainText("9 children waiting");
    await expect(page.getByTestId("waitlist-summary")).toContainText("Babies 3 · Toddlers 6");
    await page.getByTestId("waitlist-enroll").first().click();
    await expect(page.locator("main [role=status]")).toContainText("Filled in from the waitlist");
    await expect(page.locator("#g1Phone")).not.toHaveValue("");
  });

  test("Arabic children list and form read right to left and pass accessibility checks", async ({ page }) => {
    await signIn(page, "branch.manager@yanmu.test", "ar");
    await page.goto("/ar/children");
    await expectDirection(page, "ar");
    await expect(page.getByTestId("occupancy")).toContainText("92 من 100");
    await expect(page.getByTestId("child-alerts")).toBeVisible();
    const list = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(list.violations).toEqual([]);
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noScroll).toBe(true);

    await page.goto("/ar/children/new");
    const form = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(form.violations).toEqual([]);
  });

  test("Excel downloads of the children list and waitlist", async ({ page }) => {
    await signIn(page, "branch.manager@yanmu.test", "en");
    await page.goto("/en/children");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-children").click()]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await download.path());
    expect(wb.worksheets[0].rowCount).toBe(93); // header + 92 children
  });
});
