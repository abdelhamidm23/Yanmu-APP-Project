"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Alert } from "@/components/ui/Alert";

export function LoginForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale() as "ar" | "en";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const { data, error: err } = await authClient.signIn.email({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      if (err) {
        setError(err.status === 429 ? t("tooManyAttempts") : err.status === 401 ? t("invalidCredentials") : t("genericError"));
        return;
      }
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        router.push("/login/two-factor");
        return;
      }
      // The language chosen on the sign-in screen becomes the saved preference.
      await authClient.updateUser({ locale });
      // The server picks the start screen for this person's role.
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
      <TextField id="email" name="email" type="email" label={t("email")} autoComplete="username" inputMode="email" dir="ltr" required />
      <TextField id="password" name="password" type="password" label={t("password")} autoComplete="current-password" dir="ltr" required />
      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit" full disabled={busy}>
        {busy ? t("signingIn") : t("signIn")}
      </Button>
    </form>
  );
}
