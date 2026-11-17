import { getTranslations } from "next-intl/server";

/** Shown on every screen when DEMO_MODE=true (docs/SPEC.md §16). */
export async function DemoPill() {
  if (process.env.DEMO_MODE !== "true") return null;
  const t = await getTranslations("app");
  return (
    <span className="inline-flex items-center rounded-full bg-attention-bg px-3 py-1 text-meta font-semibold text-attention">
      {t("demoData")}
    </span>
  );
}
