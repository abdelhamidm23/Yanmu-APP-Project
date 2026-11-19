"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/**
 * Reads one QR code with the phone's back camera. Uses the browser's own barcode reader where there
 * is one (Android Chrome) and the jsQR library elsewhere (iPhone Safari). Nothing leaves the phone.
 */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const t = useTranslations("attendance");
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [typed, setTyped] = useState("");
  const done = useRef(onResult);
  useEffect(() => {
    done.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const canvas = document.createElement("canvas");

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        setFailed(true);
        return;
      }
      if (stopped || !video.current) return stream.getTracks().forEach((tr) => tr.stop());
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});

      const Native = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      const native = Native ? new Native({ formats: ["qr_code"] }) : null;
      const jsQR = native ? null : (await import("jsqr")).default;

      const tick = async () => {
        if (stopped || !video.current) return;
        const v = video.current;
        let text: string | null = null;
        if (v.readyState >= 2 && v.videoWidth) {
          try {
            if (native) {
              text = (await native.detect(v))[0]?.rawValue ?? null;
            } else if (jsQR) {
              const scale = Math.min(1, 640 / v.videoWidth);
              canvas.width = Math.round(v.videoWidth * scale);
              canvas.height = Math.round(v.videoHeight * scale);
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                text = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
              }
            }
          } catch {
            text = null;
          }
        }
        if (text) {
          stopped = true;
          stream?.getTracks().forEach((tr) => tr.stop());
          done.current(text);
          return;
        }
        timer = setTimeout(tick, 200);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return (
    <div className="flex flex-col gap-3" data-testid="qr-scanner">
      {failed ? (
        <Alert>{t("cameraBlocked")}</Alert>
      ) : (
        <>
          <p className="text-[14px] text-muted">{t("scanHelp")}</p>
          <video ref={video} muted playsInline className="aspect-square w-full max-w-sm self-center rounded-card bg-ink object-cover" />
        </>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) done.current(typed);
        }}
      >
        <label htmlFor="qr-typed" className="text-[13px] font-medium text-subtle">
          {t("scanTyped")}
        </label>
        <div className="flex gap-2">
          <input
            id="qr-typed"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            dir="ltr"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="min-h-11 flex-1 rounded-button border border-outline bg-surface px-3 font-mono text-[15px]"
          />
          <Button type="submit" variant="secondary" data-testid="check-typed-code">
            {t("scanCheck")}
          </Button>
        </div>
      </form>
      <Button variant="secondary" onClick={onClose} data-testid="close-scanner">
        {t("scanClose")}
      </Button>
    </div>
  );
}
