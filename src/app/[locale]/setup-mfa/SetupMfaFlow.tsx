"use client";
import { useState } from "react";
import QRCode from "qrcode";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Alert } from "@/components/ui/Alert";

type Step = { kind: "password" } | { kind: "scan"; qr: string; secret: string; backupCodes: string[] } | { kind: "backup"; backupCodes: string[] };

export function SetupMfaFlow() {
  const t = useTranslations("mfa");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    try {
      const { data, error: err } = await authClient.twoFactor.enable({ password });
      if (err || !data || !("totpURI" in data)) {
        setError(err?.status === 429 ? tAuth("tooManyAttempts") : t("wrongPassword"));
        return;
      }
      const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
      const qr = await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 });
      setStep({ kind: "scan", qr, secret, backupCodes: data.backupCodes });
    } catch {
      setError(tAuth("genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.kind !== "scan") return;
    setError(null);
    setBusy(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    try {
      const { error: err } = await authClient.twoFactor.verifyTotp({ code });
      if (err) {
        setError(tAuth("invalidCode"));
        return;
      }
      setStep({ kind: "backup", backupCodes: step.backupCodes });
    } catch {
      setError(tAuth("genericError"));
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === "password") {
    return (
      <form onSubmit={start} className="flex flex-col gap-4" noValidate>
        <ol className="flex list-decimal flex-col gap-2 ps-5 text-[14px]">
          <li>{t("step1")}</li>
          <li>{t("step2")}</li>
          <li>{t("step3")}</li>
        </ol>
        <TextField id="password" name="password" type="password" label={t("confirmPassword")} autoComplete="current-password" dir="ltr" required />
        {error ? <Alert>{error}</Alert> : null}
        <Button data-testid="mfa-start" type="submit" full disabled={busy}>
          {busy ? t("starting") : t("start")}
        </Button>
      </form>
    );
  }

  if (step.kind === "scan") {
    return (
      <form onSubmit={confirm} className="flex flex-col gap-4" noValidate>
        <p className="text-[14px]">{t("step3")}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated in the browser */}
        <img src={step.qr} alt={t("qrAlt")} width={220} height={220} className="mx-auto rounded-tile border border-border" />
        <div className="flex flex-col gap-1">
          <p className="text-meta text-muted">{t("manualKey")}</p>
          <code dir="ltr" data-testid="totp-secret" className="figure break-all rounded-chip bg-bg px-2 py-1.5 text-[13px]">
            {step.secret}
          </code>
        </div>
        <TextField id="code" name="code" label={tAuth("code")} autoComplete="one-time-code" inputMode="numeric" maxLength={6} dir="ltr" required />
        {error ? <Alert>{error}</Alert> : null}
        <Button data-testid="mfa-confirm" type="submit" full disabled={busy}>
          {busy ? tAuth("verifying") : t("finish")}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="good">{t("enabled")}</Alert>
      <h2 className="text-section-title font-semibold">{t("backupTitle")}</h2>
      <p className="text-[14px] text-muted">{t("backupIntro")}</p>
      <ul dir="ltr" className="figure grid grid-cols-2 gap-2 rounded-tile bg-bg p-3 text-[14px]" data-testid="backup-codes">
        {step.backupCodes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button data-testid="mfa-done" full onClick={() => {
          router.replace("/");
          router.refresh();
        }}>
        {t("continue")}
      </Button>
    </div>
  );
}
