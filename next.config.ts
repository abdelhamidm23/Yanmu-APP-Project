import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Behind a forwarding proxy (the Codespaces demo) the browser's address differs from the host the
// server sees. The app's own public address and the extra sign-in addresses (TRUSTED_ORIGINS, where
// "https://*.example.com" means any subdomain) may post forms. Read again by `next start`.
const formOrigins = [process.env.BETTER_AUTH_URL ?? "", ...(process.env.TRUSTED_ORIGINS ?? "").split(",")]
  .map((origin) => origin.trim().replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").replace(/^\*\./, "**."))
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // The floating Next.js dev badge covers the bottom navigation on phones.
  devIndicators: false,
  // Photos and signed consent scans are up to 5 MB each (spec §8.1); a form may carry a few.
  experimental: { serverActions: { bodySizeLimit: "24mb", allowedOrigins: formOrigins.length ? formOrigins : undefined } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=()" },
          // The online demo must not show up in search engines.
          ...(process.env.DEMO_MODE === "true" ? [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] : []),
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
