import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/Alert";

export async function ClosingResult({ searchParams }: { searchParams: { ok?: string; done?: string; error?: string } }) {
  const t = await getTranslations("closing");
  if (searchParams.ok) {
    const key = `ok.${searchParams.done ?? "saved"}`;
    return <Alert tone="good">{t.has(key) ? t(key as "ok.saved") : t("ok.saved")}</Alert>;
  }
  if (searchParams.error) {
    const key = `errors.${searchParams.error}`;
    return <Alert>{t.has(key) ? t(key as "errors.unknown") : t("errors.unknown")}</Alert>;
  }
  return null;
}
