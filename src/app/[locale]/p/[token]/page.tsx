import type { Metadata } from "next";
import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import { linkChildren } from "@/db/pickup";
import { todayInCairo } from "@/lib/calendar";
import { formatPlainDate } from "@/lib/format";
import { hashPickupLinkSecret, isPickupLinkSecret } from "@/lib/pickup-card";
import { dailyPickupCode, formatPickupCode, pickupQrText } from "@/lib/pickup-code";

// Today's codes: never cached, never indexed, and the link is not passed on to other sites.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * An approved adult's private pickup page (owner, 2026-11-19). No sign-in: the secret in the link is
 * the key. It shows today's pickup QR for every child this adult may collect; the front desk scans it.
 */
export default async function PickupLinkPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  const t = await getTranslations("pickupPage");
  const loc = locale === "en" ? "en" : "ar";
  const rows = isPickupLinkSecret(token) ? await linkChildren(hashPickupLinkSecret(token)) : [];
  const today = todayInCairo();
  const children = await Promise.all(
    rows.map(async (r) => {
      const code = dailyPickupCode(r.student_id, today, r.pickup_code_version);
      const svg = await QRCode.toString(pickupQrText(code), { type: "svg", margin: 2, errorCorrectionLevel: "M" });
      return { id: r.student_id, name: loc === "ar" ? r.full_name_ar : r.full_name_en, branch: loc === "ar" ? r.branch_name_ar : r.branch_name_en, code, svg };
    }),
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 bg-bg px-4 py-6">
      <h1 className="text-page-title font-semibold">{t("title")}</h1>
      {rows.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4" data-testid="pickup-page-empty">
          {t("none")}
        </p>
      ) : (
        <>
          <p className="text-[15px]">{t("for", { adult: rows[0].guardian_name })}</p>
          <p className="font-semibold" data-testid="pickup-page-date">
            {t("date", { date: formatPlainDate(today, loc, "latin") })}
          </p>
          <p className="text-[14px] text-subtle">{t("intro")}</p>
          <ul className="flex flex-col gap-4">
            {children.map((c) => (
              <li key={c.id} className="flex flex-col items-center gap-2 rounded-card border border-border bg-surface p-4 text-center" data-testid="pickup-page-child" data-qr={pickupQrText(c.code)}>
                <span className="text-row-title font-semibold">{c.name}</span>
                <span className="text-meta text-muted">{c.branch}</span>
                {/* The SVG is made on our server by the qrcode library from the code alone. */}
                <span className="block w-64 max-w-full rounded-card bg-white p-2" role="img" aria-label={t("title")} dangerouslySetInnerHTML={{ __html: c.svg }} />
                <span className="text-meta text-muted">{t("codeLabel")}</span>
                <span className="font-mono text-[22px] font-semibold tracking-wider" dir="ltr" data-testid="pickup-page-code">
                  {formatPickupCode(c.code)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-[13px] text-muted">{t("keepPrivate")}</p>
      <a href={`/${loc === "ar" ? "en" : "ar"}/p/${encodeURIComponent(token)}`} className="min-h-11 self-start py-2 text-brand underline" lang={loc === "ar" ? "en" : "ar"}>
        {loc === "ar" ? "English" : "العربية"}
      </a>
    </main>
  );
}
