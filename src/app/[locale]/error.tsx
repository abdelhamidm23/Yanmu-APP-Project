"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("common");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-page-title font-semibold">{t("errorTitle")}</h1>
      <p className="text-muted">{t("errorBody")}</p>
      <Button onClick={reset}>{t("retry")}</Button>
    </main>
  );
}
