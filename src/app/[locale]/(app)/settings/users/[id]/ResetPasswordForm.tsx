"use client";
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { resetPassword, type ResetPasswordState } from "../actions";

export function ResetPasswordForm({ userId }: { userId: string }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(resetPassword, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={userId} />
      {state.status === "ok" ? (
        <>
          <Alert tone="good">{t("users.passwordReset")}</Alert>
          <code dir="ltr" data-testid="temp-password" className="figure w-fit rounded-chip bg-bg px-3 py-2 text-[18px] font-semibold">
            {state.password}
          </code>
        </>
      ) : null}
      {state.status === "error" ? <Alert>{t(`result.${state.code as "unknown"}`)}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t("users.resetPassword")}
      </Button>
    </form>
  );
}
