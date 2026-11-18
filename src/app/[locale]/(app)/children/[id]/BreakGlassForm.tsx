"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { breakGlass, type BreakGlassState } from "./actions";

/** Owner / company manager: medical notes open only after a written reason, which is logged. */
export function BreakGlassForm({ studentId }: { studentId: string }) {
  const t = useTranslations("children");
  const [state, action, pending] = useActionState<BreakGlassState, FormData>(breakGlass, { status: "idle" });

  if (state.status === "ok") {
    const m = state.medical;
    return (
      <div className="flex flex-col gap-2" data-testid="medical-opened">
        <p className="text-meta text-muted">{t("detail.breakGlassLogged")}</p>
        {m && (m.allergies || m.conditions || m.medications || m.doctorContact) ? (
          <dl className="flex flex-col gap-2 text-[14px]">
            {(["allergies", "conditions", "medications", "doctorContact"] as const).map((k) =>
              m[k] ? (
                <div key={k}>
                  <dt className="text-muted">{t(`medical.${k}`)}</dt>
                  <dd className="whitespace-pre-line">{m[k]}</dd>
                </div>
              ) : null,
            )}
          </dl>
        ) : (
          <p className="text-[14px]">{t("detail.medicalNone")}</p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3" data-testid="break-glass">
      <input type="hidden" name="studentId" value={studentId} />
      <p className="text-[14px] text-subtle">{t("detail.medicalHidden")}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor="bg-reason" className="text-[13px] font-medium text-subtle">
          {t("detail.breakGlassReason")}
        </label>
        <input id="bg-reason" name="reason" required minLength={5} maxLength={300} className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]" />
      </div>
      {state.status === "error" ? <Alert>{t.has(`errors.${state.code}`) ? t(`errors.${state.code}` as "errors.unknown") : t("errors.unknown")}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t("detail.breakGlassOpen")}
      </Button>
    </form>
  );
}
