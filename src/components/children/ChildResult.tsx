import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/Alert";

/** Outcome of the last change on a children screen (?ok=1 or ?error=code), in plain words. */
export async function ChildResult({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const t = await getTranslations("children");
  if (searchParams.ok === "pending") return <Alert tone="good">{t("form.savedPending")}</Alert>;
  if (searchParams.ok) return <Alert tone="good">{t("saved")}</Alert>;
  if (searchParams.error) {
    const key = `errors.${searchParams.error}`;
    return <Alert>{t.has(key) ? t(key as "errors.unknown") : t("errors.unknown")}</Alert>;
  }
  return null;
}
