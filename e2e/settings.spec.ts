import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { expectDirection, signIn, signInWithNewMfa } from "./helpers";

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

test.describe("settings (Phase 1)", () => {
  test("company manager adds a class and a user, and sees both in the audit log", async ({ page }) => {
    execSync("pnpm -s seed:dev-users --reset", { stdio: "ignore" });
    await signInWithNewMfa(page, "company.manager@yanmu.test", "en");

    // More lists the settings in their own groups (owner's review): setup, people, records.
    await page.getByTestId("nav-more").click();
    await expect(page.getByTestId("settings-group-setup")).toContainText("Branches and classes");
    await expect(page.getByTestId("settings-group-setup")).toContainText("Calendar and hours");
    await expect(page.getByTestId("settings-group-people")).toContainText("Users and roles");
    await expect(page.getByTestId("settings-group-records")).toContainText("Audit log");

    // Opening hours: 8 to 4, with the after-school time to 5 PM.
    await page.getByTestId("settings-calendar").click();
    await expect(page.getByTestId("hours-summary")).toHaveText("Open 08:00 to 16:00, after-school until 17:00.");
    await page.locator("#h-after").fill("45");
    await page.getByTestId("save-hours").click();
    await expect(page.locator("main [role=status]")).toHaveText("Saved.");
    await expect(page.getByTestId("hours-summary")).toHaveText("Open 08:00 to 16:00, after-school until 16:45.");
    await page.locator("#h-after").fill("60");
    await page.getByTestId("save-hours").click();
    await expect(page.getByTestId("hours-summary")).toHaveText("Open 08:00 to 16:00, after-school until 17:00.");

    // Add a class to Yanmu.
    await page.goto("/en/more");
    const roomName = `Sunflower ${stamp()}`;
    await page.getByTestId("settings-branches").click();
    await page.getByTestId("branch-list").getByRole("link", { name: /Yanmu/ }).click();
    const form = page.getByTestId("add-room");
    await form.locator("#nr-ar").fill("عباد الشمس");
    await form.locator("#nr-en").fill(roomName);
    await form.locator("#nr-cap").fill("12");
    await form.getByRole("button").click();
    await expect(page.locator("main [role=status]")).toHaveText("Saved.");
    await expect(page.getByTestId("room-list").locator(`input[value="${roomName}"]`)).toHaveCount(1);

    // Add a teacher for Yanmu; a temporary password is shown once.
    const email = `teacher.${stamp()}@yanmu.test`;
    await page.goto("/en/settings/users/new");
    // Nothing on the form is wider than the phone screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator("#u-name").fill("New Teacher (test)");
    await page.locator("#u-email").fill(email);
    await page.getByRole("checkbox", { name: "Teacher · Yanmu" }).check();
    await page.getByRole("button", { name: "Add a user" }).click();
    await expect(page.getByTestId("temp-password")).toHaveText(/^[A-Z][a-z]+-\d{4}-[A-Z][a-z]+$/);
    await page.goto("/en/settings/users");
    await expect(page.getByTestId("user-list")).toContainText(email);

    // Both changes are in the audit log, with who made them.
    await page.goto("/en/settings/audit");
    const log = page.getByTestId("audit-list");
    await expect(log).toContainText(roomName);
    await expect(log).toContainText(email);
    await expect(log.locator("li").first()).toContainText("Company manager (test)");

    // The audit log exports to Excel.
    const download = page.waitForEvent("download");
    await page.getByTestId("export-audit").click();
    expect((await download).suggestedFilename()).toMatch(/^audit-\d{4}-\d\d-\d\d\.xlsx$/);

    // Arabic settings screen is right-to-left and passes the accessibility check.
    await page.goto("/ar/settings/values");
    await expectDirection(page, "ar");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });

  test("branch manager adds a holiday for their own branch only; the other branch does not see it", async ({ page }) => {
    const note = `Test holiday ${stamp()}`;
    const day = String(1 + Math.floor(Math.random() * 27)).padStart(2, "0");
    await signIn(page, "branch.manager@yanmu.test", "en");
    await expect(page).toHaveURL(/\/en\/today$/);
    await page.goto("/en/settings/calendar");
    const form = page.getByTestId("add-exception");
    await expect(form.locator("#ex-branch option")).toHaveCount(1);
    await expect(form.locator("#ex-branch option")).toHaveText("Yanmu");
    await form.locator("#ex-date").fill(`2031-03-${day}`);
    await form.locator("#ex-note").fill(note);
    await form.getByRole("button").click();
    await expect(page.getByTestId("exception-list")).toContainText(note);
    // The branch manager sees the opening hours but cannot change them.
    await expect(page.getByTestId("hours-summary")).toContainText("after-school until");
    await expect(page.getByTestId("save-hours")).toHaveCount(0);

    // Branch-only screens are not there for a branch manager.
    expect((await page.goto("/en/settings/branches"))?.status()).toBe(404);
    expect((await page.goto("/en/settings/users"))?.status()).toBe(404);
    expect((await page.goto("/en/settings/audit"))?.status()).toBe(404);
    expect((await page.goto("/api/export/users?locale=en"))?.status()).toBe(404);

    await page.context().clearCookies();
    await signIn(page, "branch.manager.b@yanmu.test", "en");
    await expect(page).toHaveURL(/\/en\/today$/);
    await page.goto("/en/settings/calendar");
    await expect(page.getByTestId("exception-list")).not.toContainText(note);
  });

  test("teacher has no settings", async ({ page }) => {
    await signIn(page, "teacher@yanmu.test", "en");
    await expect(page).toHaveURL(/\/en\/my-class$/);
    expect((await page.goto("/en/settings"))?.status()).toBe(404);
    expect((await page.goto("/en/settings/calendar"))?.status()).toBe(404);
    await page.goto("/en/more");
    await expect(page.getByTestId("settings-group-setup")).toHaveCount(0);
    await expect(page.getByTestId("settings-calendar")).toHaveCount(0);
  });
});
