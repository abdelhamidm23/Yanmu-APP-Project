import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { withUserDb } from "@/db/rls";
import { ageBand } from "@/db/schema";
import { requireSettings } from "@/lib/require-user";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, PageHeader } from "@/components/settings/Fields";
import { ResultBanner } from "@/components/settings/ResultBanner";
import { updateAgeBand } from "./actions";

export default async function AgeBandsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const user = await requireSettings(locale);
  const t = await getTranslations("settings");
  const bands = await withUserDb(user.id, (tx) => tx.select().from(ageBand).orderBy(asc(ageBand.sort)));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("ageBands.title")} />
      <ResultBanner searchParams={await searchParams} />
      {bands.map((b) => (
        <Card key={b.id}>
          <h2 className="text-section-title font-semibold">
            {localName(b, locale)} <span className="figure text-meta font-medium text-muted">· {t("ageBands.ratioDisplay", { count: b.childrenPerStaff })}</span>
          </h2>
          <form action={updateAgeBand} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={b.id} />
            <Field id={`ab-${b.key}-ar`} name="nameAr" label={t("common.nameAr")} defaultValue={b.nameAr} dir="rtl" required />
            <Field id={`ab-${b.key}-en`} name="nameEn" label={t("common.nameEn")} defaultValue={b.nameEn} dir="ltr" required />
            <Field id={`ab-${b.key}-min`} name="minAgeMonths" type="number" min={0} label={t("ageBands.minAge")} defaultValue={b.minAgeMonths} required />
            <Field id={`ab-${b.key}-max`} name="maxAgeMonths" type="number" min={1} label={t("ageBands.maxAge")} defaultValue={b.maxAgeMonths} required />
            <Field id={`ab-${b.key}-ratio`} name="childrenPerStaff" type="number" min={1} label={t("ageBands.ratio")} defaultValue={b.childrenPerStaff} required />
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                {t("common.save")}
              </Button>
            </div>
          </form>
        </Card>
      ))}
    </div>
  );
}
