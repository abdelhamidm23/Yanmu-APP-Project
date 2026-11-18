"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

/** "People on this phone": tap your name, type your PIN (spec §14 shared class phones). */
export function PinLogin({ people }: { people: { id: string; name: string }[] }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [chosen, setChosen] = useState<string | null>(people.length === 1 ? people[0].id : null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/pin/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: chosen, pin }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setPin("");
      setError(
        res.status === 429 ? t("tooManyAttempts")
        : body.message === "locked" ? t("pinLocked")
        : body.message === "wrong_pin" ? t("pinWrong")
        : body.message === "needs_mfa" ? t("pinNeedsMfa")
        : t("pinNotSetUp"),
      );
      if (body.message === "locked" || body.message === "not_set_up") router.refresh();
    } catch {
      setError(t("genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 flex flex-col gap-3 border-b border-divider pb-5" data-testid="pin-login">
      <h2 className="text-section-title font-semibold">{t("pinPeople")}</h2>
      <div className="flex flex-wrap gap-2">
        {people.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={chosen === p.id}
            onClick={() => {
              setChosen(p.id);
              setError(null);
            }}
            className={`min-h-12 rounded-button px-4 text-[15px] font-medium ${chosen === p.id ? "bg-brand text-white" : "border border-outline bg-surface"}`}
          >
            {p.name}
          </button>
        ))}
      </div>
      {chosen ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="quick-pin" className="text-[13px] font-medium text-subtle">
            {t("pin")}
          </label>
          <input
            id="quick-pin"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            required
            minLength={4}
            className="min-h-12 rounded-button border border-outline bg-surface px-3 text-center text-[20px] tracking-[0.4em]"
          />
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" full disabled={busy || pin.length < 4} data-testid="pin-submit">
            {busy ? t("signingIn") : t("signIn")}
          </Button>
        </form>
      ) : null}
      <p className="text-meta text-muted">{t("pinOrPassword")}</p>
    </section>
  );
}
