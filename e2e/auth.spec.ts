import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { expectDirection, signIn, totp } from "./helpers";

test.describe("language and direction", () => {
  test("sign-in screen is Arabic and right-to-left by default", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/ar\/login$/);
    await expectDirection(page, "ar");
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  });

  test("switching to English flips to left-to-right", async ({ page }) => {
    await page.goto("/ar/login");
    await page.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en\/login$/);
    await expectDirection(page, "en");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("sign-in screen has no serious accessibility problems in either language", async ({ page }) => {
    for (const locale of ["ar", "en"]) {
      await page.goto(`/${locale}/login`);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
    }
  });
});

test.describe("sign-in", () => {
  test("wrong password shows a plain message", async ({ page }) => {
    await page.goto("/en/login");
    await page.locator("#email").fill("teacher@yanmu.test");
    await page.locator("#password").fill("not-the-password");
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator("form [role=alert]")).toContainText("email or password is not right");
  });

  test("signed-out visitors are sent to sign in", async ({ page }) => {
    await page.goto("/en/home");
    await expect(page).toHaveURL(/\/en\/login$/);
  });

  test("teacher signs in (no MFA needed) and lands on My room", async ({ page }) => {
    await signIn(page, "teacher@yanmu.test", "ar");
    await expect(page).toHaveURL(/\/ar\/my-room$/);
    await expect(page.getByRole("heading", { name: "فصلي" })).toBeVisible();
    await expect(page.getByTestId("active-role")).toHaveText("المعلمة");
  });

  test("owner must set up MFA, then needs a code at every sign-in", async ({ page }) => {
    execSync("pnpm -s seed:dev-users --reset", { stdio: "ignore" }); // owner starts without MFA
    await signIn(page, "owner@yanmu.test", "en");
    await expect(page).toHaveURL(/\/en\/setup-mfa$/);

    // Trying to skip MFA setup is blocked on the server.
    await page.goto("/en/home");
    await expect(page).toHaveURL(/\/en\/setup-mfa$/);

    await page.locator("#password").fill(process.env.DEV_USER_PASSWORD ?? "Yanmu-dev-2026!");
    await page.getByRole("button", { name: "Create my code" }).click();
    const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
    await page.locator("#code").fill(totp(secret));
    await page.getByRole("button", { name: "Turn on" }).click();
    await expect(page.getByTestId("backup-codes").locator("li")).toHaveCount(10);
    await page.getByRole("button", { name: "I saved them, continue" }).click();
    await expect(page).toHaveURL(/\/en\/home$/);
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

    // Sign out, sign in again: now a code is required.
    await page.getByTestId("nav-more").click();
    await expect(page.getByTestId("mfa-status")).toHaveText("Two-step sign-in is on");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/en\/login$/);

    await signIn(page, "owner@yanmu.test", "en");
    await expect(page).toHaveURL(/\/en\/login\/two-factor$/);
    await page.locator("#code").fill("000000");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.locator("form [role=alert]")).toBeVisible();

    await page.locator("#code").fill(totp(secret));
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page).toHaveURL(/\/en\/home$/);
  });
});
