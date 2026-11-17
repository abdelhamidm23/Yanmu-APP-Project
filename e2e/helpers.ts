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
