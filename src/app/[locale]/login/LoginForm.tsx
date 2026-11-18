"use client";
import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Alert } from "@/components/ui/Alert";

export interface DemoLogins {
  password: string;
  accounts: { email: string; label: string }[];
}

export function LoginForm({ demo }: { demo?: DemoLogins }) {
  const formRef = useRef<HTMLFormElement>(null);
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

  function signInAs(email: string) {
    const form = formRef.current;
    if (!form || !demo) return;
    (form.elements.namedItem("email") as HTMLInputElement).value = email;
    (form.elements.namedItem("password") as HTMLInputElement).value = demo.password;
    form.requestSubmit();
  }

  return (
    <>
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <TextField id="email" name="email" type="email" label={t("email")} autoComplete="username" inputMode="email" dir="ltr" required />
      <TextField id="password" name="password" type="password" label={t("password")} autoComplete="current-password" dir="ltr" required />
      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit" full disabled={busy}>
        {busy ? t("signingIn") : t("signIn")}
      </Button>
    </form>
    {demo ? (
      <section className="mt-6 flex flex-col gap-2 border-t border-divider pt-4" data-testid="demo-accounts">
        <h2 className="text-section-title font-semibold">{t("demoTitle")}</h2>
        <p className="text-meta text-muted">
          {t("demoIntro")}{" "}
          <code dir="ltr" className="figure rounded-chip bg-bg px-1.5 py-0.5">
            {demo.password}
          </code>
        </p>
        <ul className="flex flex-col gap-1">
          {demo.accounts.map((a) => (
            <li key={a.email}>
              <button
                type="button"
                disabled={busy}
                onClick={() => signInAs(a.email)}
                className="flex min-h-11 w-full flex-col items-start justify-center rounded-button px-3 py-1.5 text-start hover:bg-bg"
              >
                <span className="text-[15px] font-medium">{a.label}</span>
                <span dir="ltr" className="text-meta text-muted">
                  {a.email}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ) : null}
    </>
  );
}
