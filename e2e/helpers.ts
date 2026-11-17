import { expect, type Page } from "@playwright/test";
import { generateSync } from "otplib";

export const PASSWORD = process.env.DEV_USER_PASSWORD ?? "Yanmu-dev-2026!";

export async function signIn(page: Page, email: string, locale: "ar" | "en" = "ar") {
  await page.goto(`/${locale}/login`);
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
