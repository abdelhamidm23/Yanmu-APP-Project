import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expectDirection, signIn } from "./helpers";

test("teacher sees the teacher tabs in Arabic", async ({ page }) => {
  await signIn(page, "teacher@yanmu.test", "ar");
  await expect(page).toHaveURL(/\/ar\/my-room$/);
  const nav = page.getByRole("navigation", { name: "التنقل الرئيسي" });
  await expect(nav.getByRole("link")).toHaveText(["فصلي", "تسجيل الحضور", "حادث", "المزيد"]);
  await expect(page.getByTestId("nav-my-room")).toHaveAttribute("aria-current", "page");
});

test("branch manager sees the branch manager tabs and the + Add sheet", async ({ page }) => {
  await signIn(page, "branch.manager@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/today$/);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link")).toHaveText(["Today", "Children", "Add", "Issues", "More"]);
  await page.getByTestId("nav-add").click();
  // Phase 2: "Child" opens the add-child form; Phase 3: "Roll call" opens the rooms. The rest arrive in later phases.
  await expect(page.getByTestId("add-actions").getByRole("button")).toHaveText(["Payment", "Expense", "Incident", "Issue"]);
  await expect(page.getByTestId("add-actions").getByRole("link", { name: "Roll call" })).toHaveAttribute("href", "/en/roll-call");
  await page.getByTestId("add-child").click();
  await expect(page).toHaveURL(/\/en\/children\/new$/);
});

test("the server refuses screens outside your role (not just hidden tabs)", async ({ page }) => {
  await signIn(page, "teacher@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/my-room$/);
  for (const path of ["/en/inbox", "/en/home", "/en/month-close", "/en/cash-box"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("language and digit preference is saved and flips direction", async ({ page }) => {
  await signIn(page, "front.desk@yanmu.test", "ar");
  await expect(page).toHaveURL(/\/ar\/today$/);
  await page.getByTestId("nav-more").click();
  await page.getByText("English", { exact: true }).click();
  await page.getByTestId("save-preferences").click();
  await expect(page).toHaveURL(/\/en\/more\?saved=1$/);
  await expectDirection(page, "en");
  await expect(page.locator("main [role=status]")).toHaveText("Saved");
});

test("a person with two roles can switch between them", async ({ page }) => {
  await signIn(page, "multi.role@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/today$/);
  await page.getByTestId("nav-more").click();
  await page.getByRole("button", { name: "Teacher" }).click();
  await expect(page).toHaveURL(/\/en\/my-room$/);
  await expect(page.getByTestId("active-role")).toHaveText("Teacher");
});

test("signed-in screens have no serious accessibility problems", async ({ page }) => {
  await signIn(page, "branch.manager@yanmu.test", "ar");
  await expect(page).toHaveURL(/\/ar\/today$/);
  for (const path of ["/ar/today", "/ar/more", "/en/today"]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, `${path}: ${JSON.stringify(serious.map((v) => v.id))}`).toEqual([]);
  }
});
