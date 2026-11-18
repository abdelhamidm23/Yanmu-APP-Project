import { getTranslations } from "next-intl/server";
import { CheckField, Field, SelectField } from "@/components/settings/Fields";
import { buttonClasses } from "@/components/ui/Button";
import { saveStaff } from "./actions";

export interface StaffValues {
  id: string;
  fullNameAr: string;
  fullNameEn: string;
  jobTitle: string;
  isQualifiedCarer: boolean;
  defaultRoomId: string | null;
  deviceEmployeeNo: string | null;
  shiftStart: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  email: string | null;
}

/** HR's form for one staff record (spec §7.2). */
export async function StaffForm({
  locale,
  branchId,
  rooms,
  values,
  readOnly,
}: {
  locale: string;
  branchId: string;
  rooms: { id: string; name: string }[];
  values: StaffValues | null;
  readOnly: boolean;
}) {
  const t = await getTranslations("staff.form");
  return (
    <form action={saveStaff} className="flex flex-col gap-3" data-testid="staff-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="staffId" value={values?.id ?? ""} />
      <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
        <Field id="fullNameAr" name="fullNameAr" label={t("nameAr")} required defaultValue={values?.fullNameAr} dir="rtl" />
        <Field id="fullNameEn" name="fullNameEn" label={t("nameEn")} required defaultValue={values?.fullNameEn} dir="ltr" />
        <Field id="jobTitle" name="jobTitle" label={t("jobTitle")} required defaultValue={values?.jobTitle} />
        <SelectField
          id="defaultRoomId"
          name="defaultRoomId"
          label={t("usualRoom")}
          defaultValue={values?.defaultRoomId ?? ""}
          options={[{ value: "", label: t("noRoom") }, ...rooms.map((r) => ({ value: r.id, label: r.name }))]}
        />
        <Field id="deviceEmployeeNo" name="deviceEmployeeNo" label={t("deviceNo")} hint={t("deviceNoHint")} defaultValue={values?.deviceEmployeeNo ?? ""} inputMode="numeric" dir="ltr" />
        <Field id="shiftStart" name="shiftStart" type="time" label={t("shiftStart")} required defaultValue={values?.shiftStart ?? "08:00"} dir="ltr" />
        <Field id="startDate" name="startDate" type="date" label={t("startDate")} defaultValue={values?.startDate ?? ""} />
        <Field id="endDate" name="endDate" type="date" label={t("endDate")} defaultValue={values?.endDate ?? ""} />
        <Field id="email" name="email" type="email" label={t("email")} hint={t("emailHint")} defaultValue={values?.email ?? ""} dir="ltr" />
        <div className="flex flex-col justify-end">
          <CheckField name="isQualifiedCarer" label={t("qualifiedCarer")} defaultChecked={values?.isQualifiedCarer ?? true} />
          {values ? <CheckField name="left" label={t("left")} defaultChecked={values.status === "left"} /> : null}
        </div>
      </fieldset>
      {readOnly ? null : (
        <button type="submit" className={`${buttonClasses("primary")} self-start`} data-testid="save-staff">
          {t("save")}
        </button>
      )}
    </form>
  );
}
