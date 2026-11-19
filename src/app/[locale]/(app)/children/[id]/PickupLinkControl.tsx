"use client";
import { useState, useTransition } from "react";
import QRCode from "qrcode";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { cancelPickupLink, issuePickupLink, newPickupCodeToday } from "./pickup-link-actions";

/**
 * The private pickup link of one approved adult: make (or replace) it, or cancel it. The page behind
 * the link shows today's pickup QR for each child this adult may collect. The link is shown only
 * right after it is made, to give to the adult; it cannot be shown again.
 */
export function PickupLinkControl({ locale, studentId, guardianId, inUseSince }: { locale: string; studentId: string; guardianId: string; inUseSince: string | null }) {
  const t = useTranslations("children.detail");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [made, setMade] = useState<{ url: string; svg: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function make() {
    if (inUseSince && !window.confirm(t("linkReplaceConfirm"))) return;
    setError(null);
    start(async () => {
      const out = await issuePickupLink({ locale, studentId, guardianId });
      if ("error" in out) return setError(out.error === "not_allowed_pickup" ? t("linkNeedsPickup") : t("linkError"));
      const url = `${window.location.origin}/${locale}/p/${out.secret}`;
      const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      setMade({ url, svg });
      setCopied(false);
      router.refresh();
    });
  }

  function cancel() {
    if (!window.confirm(t("linkCancelConfirm"))) return;
    setError(null);
    start(async () => {
      const out = await cancelPickupLink({ locale, studentId, guardianId });
      if ("error" in out) return setError(t("linkError"));
      setMade(null);
      router.refresh();
    });
  }

  async function copy() {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="pickup-link">
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <span className={inUseSince ? "text-good" : "text-muted"} data-testid="pickup-link-status">
          {inUseSince ? t("linkInUse", { date: inUseSince }) : t("linkNone")}
        </span>
        <button type="button" onClick={make} disabled={pending} className="min-h-11 px-2 text-brand underline disabled:opacity-50" data-testid="make-pickup-link">
          {inUseSince ? t("linkReplace") : t("linkMake")}
        </button>
        {inUseSince ? (
          <button type="button" onClick={cancel} disabled={pending} className="min-h-11 px-2 text-critical underline disabled:opacity-50" data-testid="cancel-pickup-link">
            {t("linkCancel")}
          </button>
        ) : null}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {made ? (
        <div className="flex flex-col gap-3 rounded-card border border-brand p-3" data-testid="pickup-link-made">
          <p className="text-[14px]">{t("linkGiveHelp")}</p>
          {/* The SVG is made in the browser by the qrcode library from the link itself. */}
          <span className="mx-auto block w-48 rounded-card bg-white p-2" aria-label={t("linkQrLabel")} role="img" dangerouslySetInnerHTML={{ __html: made.svg }} />
          <input readOnly value={made.url} dir="ltr" onFocus={(e) => e.currentTarget.select()} className="min-h-11 w-full rounded-button border border-outline bg-surface px-3 font-mono text-[13px]" data-testid="pickup-link-url" aria-label={t("linkUrlLabel")} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void copy()}>{copied ? t("linkCopied") : t("linkCopy")}</Button>
            <Button variant="secondary" onClick={() => setMade(null)}>
              {t("linkDone")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Gives the child a new pickup code for the rest of today (a screenshot went to the wrong person). */
export function NewCodeTodayButton({ locale, studentId }: { locale: string; studentId: string }) {
  const t = useTranslations("children.detail");
  const [pending, start] = useTransition();
  const [done, setDone] = useState<boolean | null>(null);
  return (
    <div className="flex flex-col gap-2" data-testid="new-code-today">
      <p className="text-[14px] text-subtle">{t("codeHelp")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(t("codeNewConfirm"))) return;
            start(async () => setDone(!("error" in (await newPickupCodeToday({ locale, studentId })))));
          }}
          data-testid="new-code-today-button"
        >
          {t("codeNew")}
        </Button>
        {done === true ? <span className="text-[14px] text-good" role="status">{t("codeNewDone")}</span> : null}
        {done === false ? <span className="text-[14px] text-critical" role="status">{t("linkError")}</span> : null}
      </div>
    </div>
  );
}
