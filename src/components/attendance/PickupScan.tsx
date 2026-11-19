"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { handOverByCode, lookupPickup, type LookupResult } from "@/app/[locale]/(app)/today/pickup-actions";
import { Avatar } from "./Avatar";
import { QrScanner } from "./QrScanner";

const time = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }).format(new Date(iso));

/**
 * Front desk pickup by daily QR (owner, 2026-11-19): scan the child's code from the parent's phone or
 * screenshot, check the face against the approved adults, tap who is collecting, hand over.
 * The server checks the code again before the child is checked out.
 */
export function PickupScan({ locale, branchId }: { locale: string; branchId: string }) {
  const t = useTranslations("today");
  const ta = useTranslations("attendance");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<{ input: string; result: LookupResult } | null>(null);
  const [adult, setAdult] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const childName = (c: { fullNameAr: string; fullNameEn: string }) => (locale === "ar" ? c.fullNameAr : c.fullNameEn);

  function onScan(text: string) {
    setScanning(false);
    setNotice(null);
    setError(null);
    setAdult(null);
    start(async () => setScanned({ input: text, result: await lookupPickup({ locale, branchId, input: text }) }));
  }

  function handOver() {
    if (!scanned || !adult || "error" in scanned.result) return;
    const { child, adults } = scanned.result;
    const name = adults.find((a) => a.id === adult)?.fullName ?? "";
    start(async () => {
      const out = await handOverByCode({ locale, branchId, input: scanned.input, guardianId: adult });
      if ("error" in out) {
        setError(ta.has(`errors.${out.error}`) ? ta(`errors.${out.error}` as "errors.unknown") : ta("errors.unknown"));
        return;
      }
      setNotice(t("scanDone", { child: childName(child), adult: name }));
      setScanned(null);
      setAdult(null);
      router.refresh();
    });
  }

  function reset() {
    setScanned(null);
    setAdult(null);
    setError(null);
  }

  const r = scanned?.result;

  return (
    <Card className="flex flex-col gap-3" data-testid="pickup-scan">
      <h2 className="text-section-title font-semibold">{t("scanTitle")}</h2>
      {notice ? (
        <p role="status" className="rounded-button bg-verified-bg p-3 text-[14px] text-verified-fg" data-testid="scan-notice">
          {notice}
        </p>
      ) : null}

      {scanning ? (
        <QrScanner onResult={onScan} onClose={() => setScanning(false)} />
      ) : !r ? (
        <>
          <p className="text-[14px] text-subtle">{t("scanIntro")}</p>
          <Button
            onClick={() => {
              setNotice(null);
              setScanning(true);
            }}
            disabled={pending}
            data-testid="scan-pickup"
          >
            {t("scanButton")}
          </Button>
        </>
      ) : null}

      {r && "error" in r ? (
        <div role="alert" className="flex flex-col gap-2 rounded-card border border-critical bg-surface p-4" data-testid={r.error === "old" ? "scan-old" : "scan-unknown"}>
          <p className="font-semibold text-critical">{r.error === "old" ? t("scanOld", { child: childName(r.child) }) : t("scanUnknown")}</p>
          <Button variant="secondary" onClick={reset}>
            {t("scanAgain")}
          </Button>
        </div>
      ) : r ? (
        <div className="flex flex-col gap-3" data-testid="scan-result" data-child={r.child.fullNameEn}>
          <div className="flex items-center gap-3">
            <Avatar photoId={r.child.photoId} name={childName(r.child)} size={72} />
            <span className="flex flex-col">
              <span className="text-meta text-good">{t("scanCodeOk")}</span>
              <span className="text-row-title font-semibold">{childName(r.child)}</span>
              <span className="text-meta text-muted">{t("scanClassLine", { name: locale === "ar" ? r.child.classNameAr : r.child.classNameEn })}</span>
            </span>
          </div>

          {r.state === "gone" ? (
            <Alert>
              {r.collectedBy
                ? t("scanGone", { child: childName(r.child), time: time(r.checkOutAt!, locale), adult: r.collectedBy })
                : t("scanGoneUnknownAdult", { child: childName(r.child), time: time(r.checkOutAt!, locale) })}
            </Alert>
          ) : r.state === "not_in" ? (
            <Alert>{t("scanNotIn", { child: childName(r.child) })}</Alert>
          ) : r.adults.length === 0 ? (
            <Alert>{t("scanNoAdults")}</Alert>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-semibold">{t("scanWho")}</legend>
              <p className="text-[14px]">{t("scanFace")}</p>
              {r.adults.map((a) => (
                <label key={a.id} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-button border p-2 ${adult === a.id ? "border-brand bg-brand-tint" : "border-border"}`}>
                  <input type="radio" name="scan-adult" value={a.id} checked={adult === a.id} onChange={() => setAdult(a.id)} className="size-5" data-testid="scan-adult" />
                  <Avatar photoId={a.photoId} name={a.fullName} size={56} />
                  <span className="flex flex-col">
                    <span className="font-semibold">{a.fullName}</span>
                    <span className="text-meta text-muted">{ta(`relationship.${a.relationship}` as "relationship.other")}</span>
                  </span>
                </label>
              ))}
              <p className="text-[14px] text-critical">{t("scanNotOnList")}</p>
              {error ? <Alert>{error}</Alert> : null}
              <Button onClick={handOver} disabled={!adult || pending} data-testid="scan-hand-over">
                {t("scanHandOver")}
              </Button>
            </fieldset>
          )}
          <Button variant="secondary" onClick={reset} data-testid="scan-cancel">
            {r.state === "in" ? t("scanCancel") : t("scanAgain")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
