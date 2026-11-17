import { getTranslations } from "next-intl/server";
import { Field, SelectField } from "@/components/settings/Fields";

export async function UserDetailsFields({
  values,
  withEmail,
  withEndDate,
}: {
  values?: { name: string; email: string; phone: string | null; locale: string; endDate: string | null };
  withEmail: boolean;
  withEndDate: boolean;
}) {
  const t = await getTranslations();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="u-name" name="name" label={t("settings.users.name")} defaultValue={values?.name} required minLength={2} />
      {withEmail ? (
        <Field id="u-email" name="email" type="email" label={t("settings.users.email")} dir="ltr" required autoComplete="off" />
      ) : (
        <Field id="u-email" label={t("settings.users.email")} dir="ltr" defaultValue={values?.email} disabled />
      )}
      <Field id="u-phone" name="phone" type="tel" label={t("settings.users.phone")} dir="ltr" defaultValue={values?.phone ?? ""} />
      <SelectField
        id="u-locale"
        name="userLocale"
        label={t("settings.users.language")}
        defaultValue={values?.locale ?? "ar"}
        options={[
          { value: "ar", label: t("common.arabic") },
          { value: "en", label: t("common.english") },
        ]}
      />
      {withEndDate ? (
        <Field id="u-end" name="endDate" type="date" label={t("settings.users.endDate")} hint={t("settings.users.endDateHint")} defaultValue={values?.endDate ?? ""} />
      ) : null}
    </div>
  );
}
