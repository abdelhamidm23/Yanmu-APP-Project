"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Alert } from "@/components/ui/Alert";

export function TwoFactorForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale() as "ar" | "en";
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\s/g, "");
    const trustDevice = form.get("trust") === "on";
    try {
      const { error: err } = backup
        ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
        : await authClient.twoFactor.verifyTotp({ code, trustDevice });
      if (err) {
        setError(err.status === 429 ? t("tooManyAttempts") : t("invalidCode"));
        return;
      }
      await authClient.updateUser({ locale });
      router.replace("/");
      router.refresh();
    } catch {
      setError(t("genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {backup ? (
        <TextField key="backup" id="code" name="code" label={t("backupCode")} autoComplete="one-time-code" dir="ltr" required />
      ) : (
        <TextField
          key="totp"
          id="code"
          name="code"
          label={t("code")}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          dir="ltr"
          required
        />
      )}
      <label className="flex min-h-11 items-center gap-3 text-[14px]">
        <input type="checkbox" name="trust" className="size-5 accent-brand" />
        {t("trustDevice")}
      </label>
      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit" full disabled={busy}>
        {busy ? t("verifying") : t("verify")}
      </Button>
      <button type="button" className="min-h-11 text-[14px] font-medium text-brand underline" onClick={() => setBackup((b) => !b)}>
        {backup ? t("useAppCode") : t("useBackupCode")}
      </button>
      <Link href="/login" className="inline-flex min-h-11 items-center justify-center text-[14px] text-muted underline">
        {t("backToSignIn")}
      </Link>
    </form>
  );
}
