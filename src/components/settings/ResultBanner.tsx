import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/Alert";

const CODES = ["forbidden", "duplicate", "invalid", "unknown", "self", "notFound"] as const;

/** Shows the outcome of the last form submit, carried in the URL (?ok=1 or ?error=code). */
export async function ResultBanner({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const t = await getTranslations("settings.result");
  if (searchParams.ok) return <Alert tone="good">{t("ok")}</Alert>;
  const code = CODES.find((c) => c === searchParams.error);
  if (code) return <Alert>{t(code)}</Alert>;
  return null;
}
