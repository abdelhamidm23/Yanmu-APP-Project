import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ar", "en"],
  defaultLocale: "ar",
  localePrefix: "always",
  // Arabic is the primary staff language: "/" always opens Arabic. A signed-in
  // person is then sent to the language saved in their profile (see [locale]/page.tsx).
  localeDetection: false,
});

export type AppLocale = (typeof routing.locales)[number];

export function directionFor(locale: string): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
