"use client";
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClasses } from "@/components/ui/Button";
import { createUser, type CreateUserState } from "../actions";

/** Client wrapper so the temporary password comes back in the response, never in a URL. */
export function NewUserForm({ children }: { children: React.ReactNode }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [state, action, pending] = useActionState<CreateUserState, FormData>(createUser, { status: "idle" });

  if (state.status === "ok") {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="good">{t("users.created")}</Alert>
        <code dir="ltr" data-testid="temp-password" className="figure w-fit rounded-chip bg-bg px-3 py-2 text-[18px] font-semibold">
          {state.password}
        </code>
        <Link href={`/settings/users/${state.userId}`} className={`${buttonClasses("secondary")} self-start`}>
          {t("users.edit")}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      {children}
      {state.status === "error" ? <Alert>{t(`result.${state.code as "invalid"}`)}</Alert> : null}
      <Button type="submit" disabled={pending} className="self-start">
        {t("users.addUser")}
      </Button>
    </form>
  );
}
