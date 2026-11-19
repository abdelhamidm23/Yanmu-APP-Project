"use client";
import { useState, useTransition } from "react";
import QRCode from "qrcode";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { pickupQrText } from "@/lib/pickup-card";
import { cancelPickupCard, issuePickupCard } from "./pickup-card-actions";

/**
 * QR pickup card for one approved adult: make (or replace) the card, print it, or cancel it.
 * The code is shown only right after it is made, for printing; it cannot be shown again.
 */
export function PickupCardControl({
  locale,
  studentId,
  guardianId,
  adultName,
  branchName,
  inUseSince,
}: {
  locale: string;
  studentId: string;
  guardianId: string;
  adultName: string;
  branchName: string;
  inUseSince: string | null;
}) {
  const t = useTranslations("children.detail");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [card, setCard] = useState<{ code: string; svg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function make() {
    if (inUseSince && !window.confirm(t("qrReplaceConfirm"))) return;
    setError(null);
    start(async () => {
      const out = await issuePickupCard({ locale, studentId, guardianId });
      if ("error" in out) return setError(out.error === "not_allowed_pickup" ? t("qrNeedsPickup") : t("qrError"));
      const svg = await QRCode.toString(pickupQrText(out.code), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      setCard({ code: out.code, svg });
      router.refresh();
    });
  }

  function cancel() {
    if (!window.confirm(t("qrCancelConfirm"))) return;
    setError(null);
    start(async () => {
      const out = await cancelPickupCard({ locale, studentId, guardianId });
      if ("error" in out) return setError(t("qrError"));
      setCard(null);
      router.refresh();
    });
  }

  const grouped = card ? card.code.match(/.{1,4}/g)!.join(" ") : "";

  return (
    <div className="flex flex-col gap-2" data-testid="pickup-card">
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <span className={inUseSince ? "text-good" : "text-muted"} data-testid="pickup-card-status">
          {inUseSince ? t("qrInUse", { date: inUseSince }) : t("qrNone")}
        </span>
        <button type="button" onClick={make} disabled={pending} className="min-h-11 px-2 text-brand underline disabled:opacity-50" data-testid="make-pickup-card">
          {inUseSince ? t("qrReplace") : t("qrMake")}
        </button>
        {inUseSince ? (
          <button type="button" onClick={cancel} disabled={pending} className="min-h-11 px-2 text-critical underline disabled:opacity-50" data-testid="cancel-pickup-card">
            {t("qrCancel")}
          </button>
        ) : null}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {card ? (
        <div className="flex flex-col gap-3 rounded-card border border-brand p-3">
          <p className="text-[14px]">{t("qrPrintHelp")}</p>
          <div className="print-area mx-auto flex w-64 flex-col items-center gap-2 rounded-card border border-ink bg-white p-4 text-center text-black" data-testid="pickup-card-print">
            <span className="text-[13px] font-semibold uppercase tracking-wide">{t("qrCardTitle", { branch: branchName })}</span>
            {/* The SVG is made in the browser by the qrcode library from our own code. */}
            <span className="block w-48" aria-label={t("qrCardTitle", { branch: branchName })} role="img" dangerouslySetInnerHTML={{ __html: card.svg }} />
            <span className="font-semibold">{adultName}</span>
            <span className="font-mono text-[12px]" dir="ltr" data-testid="pickup-card-code">
              {grouped}
            </span>
            <span className="text-[11px]">{t("qrCardFoot")}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => window.print()}>{t("qrPrint")}</Button>
            <Button variant="secondary" onClick={() => setCard(null)}>
              {t("qrDone")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
