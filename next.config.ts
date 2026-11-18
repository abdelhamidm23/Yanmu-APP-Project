import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Behind a forwarding proxy (the Codespaces demo) the browser's address differs from the host the
// server sees; the app's own public address is always allowed to post forms.
const publicHost = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).host : undefined;

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // The floating Next.js dev badge covers the bottom navigation on phones.
  devIndicators: false,
  // Photos and signed consent scans are up to 5 MB each (spec §8.1); a form may carry a few.
  experimental: { serverActions: { bodySizeLimit: "24mb", allowedOrigins: publicHost ? [publicHost] : undefined } },
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
