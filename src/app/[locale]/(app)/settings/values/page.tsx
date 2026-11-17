import { getTranslations } from "next-intl/server";
import { withUserDb } from "@/db/rls";
import { readOrgSettings } from "@/db/settings";
import { requireSettings } from "@/lib/require-user";
import { SETTING_GROUPS, SETTINGS } from "@/lib/settings";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { ResultBanner } from "@/components/settings/ResultBanner";
import { saveValues } from "./actions";

/** Piastres → "500" or "12.50" for an input box, without floating point. */
function piastresToInput(p: unknown): string {
  if (typeof p !== "number") return "";
  const whole = Math.trunc(p / 100);
  const rest = p % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`;
}

export default async function ValuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const user = await requireSettings(locale, "admin");
  const t = await getTranslations("settings");
  const stored = await withUserDb(user.id, (tx) => readOrgSettings(tx));
  const valueOf = (key: string, fallback: unknown) => (stored.has(key) ? stored.get(key) : fallback);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("values.title")} help={t("values.help")} />
      <ResultBanner searchParams={await searchParams} />
      {SETTING_GROUPS.map((group) => {
        const defs = SETTINGS.filter((s) => s.group === group);
        const editable = defs.filter((d) => d.kind !== "weekdays");
        return (
          <Card key={group} data-testid={`values-${group}`}>
            <h2 className="text-section-title font-semibold">{t(`values.groups.${group}`)}</h2>
            {defs.some((d) => d.kind === "weekdays") ? (
              <p className="mt-2 text-[14px]">
                <Link href="/settings/calendar" className="inline-flex min-h-11 items-center font-medium text-brand underline">
                  {t("values.keys.calendar.working_days")} →
                </Link>
              </p>
            ) : null}
            {editable.length > 0 ? (
              <form action={saveValues} className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="group" value={group} />
                {editable.map((d) => {
                  const id = `v-${d.key.replace(/\./g, "-")}`;
                  const label = t(`values.keys.${d.key}` as "values.title");
                  const value = valueOf(d.key, d.default);
                  switch (d.kind) {
                    case "choice":
                      return (
                        <SelectField
                          key={d.key}
                          id={id}
                          name={d.key}
                          label={label}
                          defaultValue={String(value)}
                          options={(d.choices ?? []).map((c) => ({ value: c, label: t(`values.choices.${c}` as "values.title") }))}
                        />
                      );
                    case "piastres":
                    case "egp-nullable":
                      return (
                        <Field
                          key={d.key}
                          id={id}
                          name={d.key}
                          label={`${label} (${t("values.egp")})`}
                          inputMode="decimal"
                          dir="ltr"
                          defaultValue={piastresToInput(value)}
                          required={d.kind === "piastres"}
                          hint={d.kind === "egp-nullable" ? t("values.noCap") : undefined}
                        />
                      );
                    case "time":
                      return <Field key={d.key} id={id} name={d.key} label={label} type="time" dir="ltr" defaultValue={String(value)} required />;
                    case "minutes":
                      return (
                        <Field key={d.key} id={id} name={d.key} label={`${label} (${t("values.minutes")})`} type="number" min={1} dir="ltr" defaultValue={String(value)} required />
                      );
                    case "decimal":
                      return <Field key={d.key} id={id} name={d.key} label={label} inputMode="decimal" dir="ltr" defaultValue={String(value)} required />;
                    default:
                      return <Field key={d.key} id={id} name={d.key} label={label} type="number" min={0} dir="ltr" defaultValue={String(value)} required />;
                  }
                })}
                <div className="flex items-end sm:col-span-2">
                  <Button type="submit" variant="secondary">
                    {t("common.save")}
                  </Button>
                </div>
              </form>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
