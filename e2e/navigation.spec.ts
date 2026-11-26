import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expectDirection, signIn } from "./helpers";

test("teacher sees the teacher tabs in Arabic", async ({ page }) => {
  await signIn(page, "teacher@yanmu.test", "ar");
  await expect(page).toHaveURL(/\/ar\/my-class$/);
  const nav = page.getByRole("navigation", { name: "التنقل الرئيسي" });
  await expect(nav.getByRole("link")).toHaveText(["فصلي", "الحضور اليومي", "حادث", "المزيد"]);
  await expect(page.getByTestId("nav-my-class")).toHaveAttribute("aria-current", "page");
});

test("branch manager sees the branch manager tabs and the + Add sheet", async ({ page }) => {
  await signIn(page, "branch.manager@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/today$/);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link")).toHaveText(["Today", "Children", "Add", "Issues", "More"]);
  await page.getByTestId("nav-add").click();
  // Every action is built now (Phase 5 added Incident and Issue).
  await expect(page.getByTestId("add-actions").getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("add-actions").getByRole("link", { name: "Incident" })).toHaveAttribute("href", "/en/incidents/new");
  await expect(page.getByTestId("add-actions").getByRole("link", { name: "Issue" })).toHaveAttribute("href", "/en/issues/new");
  await expect(page.getByTestId("add-actions").getByRole("link", { name: "Daily attendance" })).toHaveAttribute("href", "/en/roll-call");
  // Payments are the accountant's (owner, 2026-11-23).
  await expect(page.getByTestId("add-actions").getByRole("link", { name: "Payment" })).toHaveCount(0);
  await expect(page.getByTestId("add-actions").getByRole("link", { name: "Expense" })).toHaveAttribute("href", "/en/expenses/new");
  await page.getByTestId("add-child").click();
  await expect(page).toHaveURL(/\/en\/children\/new$/);
});

test("the server refuses screens outside your role (not just hidden tabs)", async ({ page }) => {
  await signIn(page, "teacher@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/my-class$/);
  // The inbox is everyone's (their own alerts); closing and money screens are not a teacher's.
  for (const path of ["/en/home", "/en/month-close", "/en/cash-box", "/en/daily-close", "/en/figures"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("language and digit preference is saved and flips direction", async ({ page }) => {
  await signIn(page, "front.desk@yanmu.test", "ar");
  await expect(page).toHaveURL(/\/ar\/today$/);
  await page.getByTestId("nav-more").click();
  await page.getByTestId("open-account").click();
  await page.getByText("English", { exact: true }).click();
  await page.getByTestId("save-preferences").click();
  await expect(page).toHaveURL(/\/en\/more\/account\?saved=1$/);
  await expectDirection(page, "en");
  await expect(page.locator("main [role=status]")).toHaveText("Saved");
});

test("a person with two roles can switch between them", async ({ page }) => {
  await signIn(page, "multi.role@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/today$/);
  await page.getByTestId("nav-more").click();
  await page.getByTestId("open-account").click();
  await page.getByRole("button", { name: "Teacher" }).click();
  await expect(page).toHaveURL(/\/en\/my-class$/);
  await expect(page.getByTestId("active-role")).toHaveText("Teacher");
});

test("signed-in screens have no serious accessibility problems", async ({ page }) => {
  await signIn(page, "branch.manager@yanmu.test", "ar");
  await expect(page).toHaveURL(/\/ar\/today$/);
  for (const path of ["/ar/today", "/ar/more", "/ar/more/account", "/en/today", "/en/today/roster"]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, `${path}: ${JSON.stringify(serious.map((v) => v.id))}`).toEqual([]);
  }
});

test("every inner page has a Back button, and More is grouped with a search", async ({ page }) => {
  await signIn(page, "branch.manager@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/today$/);
  // A tab is a starting point: no Back there.
  await expect(page.getByTestId("back-button")).toHaveCount(0);

  // An inner page goes back up to the list it came from.
  await page.getByTestId("nav-children").click();
  await expect(page).toHaveURL(/\/en\/children/);
  await page.getByTestId("child-row").first().click();
  await expect(page).toHaveURL(/\/en\/children\/[0-9a-f-]{36}/);
  await page.getByTestId("back-button").click();
  await expect(page).toHaveURL(/\/en\/children(\?|$)/);

  // A page opened from Today goes back to Today.
  await page.getByTestId("nav-today").click();
  await page.getByTestId("open-roster").first().click();
  await expect(page).toHaveURL(/\/en\/today\/roster/);
  await page.getByTestId("back-button").click();
  await expect(page).toHaveURL(/\/en\/today(\?|$)/);

  // More: groups, and the search narrows them.
  await page.getByTestId("nav-more").click();
  await expect(page.getByTestId("more-group-account")).toBeVisible();
  await expect(page.getByTestId("more-group-daily")).toContainText("Daily attendance");
  await page.getByTestId("more-search").fill("fingerprint");
  await expect(page.getByTestId("open-staff-attendance")).toBeVisible();
  await expect(page.getByTestId("open-roll-call")).toHaveCount(0);
  await page.getByTestId("more-search").fill("zzzz");
  await expect(page.getByTestId("more-search-empty")).toBeVisible();

  // My account opens from More and goes back to it.
  await page.getByTestId("more-search").fill("");
  await page.getByTestId("open-account").click();
  await expect(page).toHaveURL(/\/en\/more\/account$/);
  await page.getByTestId("back-button").click();
  await expect(page).toHaveURL(/\/en\/more$/);
});
