import { getTranslations } from "next-intl/server";
import { Card } from "./ui/Card";
import { SECTION_PHASE, type Section } from "@/lib/roles";
import { formatNumber, type Digits, type Locale } from "@/lib/format";

/** Designed empty state for screens that later phases fill in (spec §0.4: no blank screens). */
export async function SectionPlaceholder({ section, locale, digits }: { section: Section; locale: Locale; digits: Digits }) {
  const t = await getTranslations();
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-page-title font-semibold">{t(`nav.${section}`)}</h1>
        <p className="mt-1 text-muted">{t(`sections.${section}`)}</p>
      </header>
      <Card className="flex flex-col gap-2">
        <span className="w-fit rounded-chip bg-brand-tint px-2 py-0.5 text-meta font-medium text-brand">
          {t("placeholder.comingIn", { phase: formatNumber(SECTION_PHASE[section], locale, digits) })}
        </span>
        <p className="text-[14px] text-subtle">{t("placeholder.body")}</p>
      </Card>
    </div>
  );
}
