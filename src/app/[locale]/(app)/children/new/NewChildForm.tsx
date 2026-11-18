"use client";
import { startTransition, useActionState, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CheckField, Field, SelectField } from "@/components/settings/Fields";
import { CONSENT_PURPOSES, RELATIONSHIPS, ageInMonths } from "@/lib/children";
import { createChild, type NewChildState } from "./actions";

interface RoomOption {
  id: string;
  name: string;
  band: string;
  min: number;
  max: number;
}

const area = "min-h-20 w-full rounded-button border border-outline bg-surface px-3 py-2 text-[15px]";

function GuardianFields({ n, required, prefill }: { n: 1 | 2; required: boolean; prefill?: { name: string; phone: string } }) {
  const t = useTranslations("children");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id={`g${n}Name`} name={`g${n}Name`} label={t("form.fullName")} required={required} defaultValue={prefill?.name} autoComplete="off" />
      <SelectField
        id={`g${n}Relationship`}
        name={`g${n}Relationship`}
        label={t("form.relationship")}
        defaultValue={n === 1 ? "mother" : "father"}
        options={RELATIONSHIPS.map((r) => ({ value: r, label: t(`relationship.${r}`) }))}
      />
      <Field id={`g${n}Phone`} name={`g${n}Phone`} type="tel" inputMode="tel" dir="ltr" label={t("form.phone")} hint={t("form.phoneHint")} required={required} defaultValue={prefill?.phone} />
      <Field id={`g${n}IdLast4`} name={`g${n}IdLast4`} inputMode="numeric" dir="ltr" maxLength={4} pattern="[0-9]{4}" label={t("form.idLast4")} />
      <Field id={`g${n}Photo`} name={`g${n}Photo`} type="file" accept="image/*" label={t("form.photo")} />
      <CheckField name={`g${n}PickUp`} label={t("form.canPickUp")} defaultChecked />
    </div>
  );
}

export function NewChildForm({
  branchId,
  today,
  rooms,
  families,
  canMedical,
  prefill,
}: {
  branchId: string;
  today: string;
  rooms: RoomOption[];
  families: { id: string; label: string }[];
  canMedical: boolean;
  prefill: { waitlistId: string; name: string; dateOfBirth: string; guardianName: string; guardianPhone: string; startDate: string } | null;
}) {
  const t = useTranslations("children");
  const locale = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<NewChildState, FormData>(createChild, { status: "idle" });
  const [familyMode, setFamilyMode] = useState<"new" | "existing">("new");
  const [dob, setDob] = useState(prefill?.dateOfBirth ?? "");
  const [start, setStart] = useState(prefill?.startDate && prefill.startDate > today ? prefill.startDate : today);
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [showSecond, setShowSecond] = useState(false);

  const room = rooms.find((r) => r.id === roomId);
  const ageAtStart = dob ? ageInMonths(dob, start > today ? start : today) : null;
  const mismatch = room && ageAtStart !== null && (ageAtStart < room.min || ageAtStart >= room.max);
  const suggested = ageAtStart !== null ? rooms.find((r) => ageAtStart >= r.min && ageAtStart < r.max) : undefined;

  function submit(extra: Record<string, string> = {}) {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const fd = new FormData(form);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    // Keep earlier answers to the duplicate and licence prompts.
    if (state.status === "overCapacity" || extra.capReason) fd.set("confirmDuplicate", "1");
    startTransition(() => action(fd));
  }

  const ageLabel = (m: number) => t("age", { years: Math.floor(m / 12), months: m % 12 });

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
      data-testid="new-child-form"
      noValidate={false}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="waitlistId" value={prefill?.waitlistId ?? ""} />

      <Card className="flex flex-col gap-3">
        <h2 className="text-section-title font-semibold">{t("form.stepChild")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="fullNameAr" name="fullNameAr" dir="rtl" lang="ar" label={t("nameAr")} required defaultValue={locale === "ar" ? prefill?.name : undefined} autoComplete="off" />
          <Field id="fullNameEn" name="fullNameEn" dir="ltr" lang="en" label={t("nameEn")} required defaultValue={locale === "en" ? prefill?.name : undefined} autoComplete="off" />
          <Field id="dateOfBirth" name="dateOfBirth" type="date" label={t("dob")} required max={today} value={dob} onChange={(e) => setDob(e.target.value)} />
          <SelectField id="gender" name="gender" label={t("genderLabel")} options={[{ value: "female", label: t("gender.female") }, { value: "male", label: t("gender.male") }]} />
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-section-title font-semibold">{t("form.stepFamily")}</h2>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">{t("form.stepFamily")}</legend>
          {(["new", "existing"] as const).map((m) => (
            <label key={m} className="flex min-h-11 items-center gap-2 text-[14px]">
              <input type="radio" name="familyMode" value={m} checked={familyMode === m} onChange={() => setFamilyMode(m)} className="size-5 accent-brand" disabled={m === "existing" && families.length === 0} />
              {t(m === "new" ? "form.familyNew" : "form.familyExisting")}
            </label>
          ))}
        </fieldset>
        {familyMode === "existing" ? (
          <>
            <SelectField id="familyId" name="familyId" label={t("form.familyPick")} options={families.map((f) => ({ value: f.id, label: f.label }))} />
            <p className="text-meta text-muted">{t("form.familyExistingHelp")}</p>
          </>
        ) : (
          <Field id="familyName" name="familyName" label={t("form.familyName")} hint={t("form.familyNameHint")} />
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-section-title font-semibold">{t("form.stepGuardians")}</h2>
        {familyMode === "existing" ? <p className="text-meta text-muted">{t("form.guardiansExistingHelp")}</p> : null}
        <h3 className="font-semibold">{t("form.guardian1")}</h3>
        <GuardianFields n={1} required={familyMode === "new"} prefill={prefill ? { name: prefill.guardianName, phone: prefill.guardianPhone } : undefined} />
        {showSecond ? (
          <>
            <h3 className="font-semibold">{t("form.guardian2")}</h3>
            <GuardianFields n={2} required={false} />
          </>
        ) : (
          <Button variant="secondary" className="self-start" onClick={() => setShowSecond(true)}>
            {t("form.addSecond")}
          </Button>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-section-title font-semibold">{t("form.stepConsent")}</h2>
        <p className="text-meta text-muted">{t("form.consentHelp")}</p>
        {CONSENT_PURPOSES.map((p) => (
          <CheckField key={p} name={`consent_${p}`} label={t(`purpose.${p}`)} defaultChecked={p === "records"} />
        ))}
        <Field id="consentScan" name="consentScan" type="file" accept="image/*,application/pdf" label={t("form.consentScan")} />
      </Card>

      {canMedical ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-section-title font-semibold">{t("form.stepMedical")}</h2>
          <p className="text-meta text-muted">{t("form.medicalHelp")}</p>
          {(["allergies", "conditions", "medications", "doctorContact"] as const).map((k) => (
            <div key={k} className="flex flex-col gap-1">
              <label htmlFor={k} className="text-[13px] font-medium text-subtle">
                {t(`medical.${k}`)}
              </label>
              <textarea id={k} name={k} className={area} maxLength={500} />
            </div>
          ))}
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <h2 className="text-section-title font-semibold">{t("form.stepRoom")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField id="roomId" name="roomId" label={t("room")} value={roomId} onChange={(e) => setRoomId(e.target.value)} options={rooms.map((r) => ({ value: r.id, label: `${r.name} · ${r.band}` }))} />
          <Field id="startDate" name="startDate" type="date" label={t("form.startDate")} required value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        {ageAtStart !== null ? (
          <p className="figure text-meta text-subtle" data-testid="age-at-start">
            {t("form.ageAtStart", { age: ageLabel(Math.max(ageAtStart, 0)) })}
            {suggested && suggested.id !== roomId ? ` · ${t("form.suggestedRoom", { room: suggested.name })}` : ""}
          </p>
        ) : null}
        {mismatch ? (
          <Field id="bandReason" name="bandReason" label={t("form.bandReason")} hint={t("form.bandHint", { room: room!.name, band: room!.band })} required />
        ) : null}
      </Card>

      {state.status === "duplicate" ? (
        <Card className="flex flex-col gap-3 border-attention" data-testid="duplicate-warning">
          <h2 className="text-section-title font-semibold text-attention">{t("form.duplicateTitle")}</h2>
          <ul className="flex flex-col gap-1 text-[14px]">
            {state.matches.map((m) => (
              <li key={m.id}>
                <Link href={`/children/${m.id}`} className="text-brand underline" target="_blank">
                  {t(m.reason === "phone" ? "form.duplicatePhone" : "form.duplicateNameAndBirth", { name: m.name, number: m.studentNo })}
                </Link>
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="self-start" disabled={pending} onClick={() => submit({ confirmDuplicate: "1" })} data-testid="save-anyway">
            {t("form.saveAnyway")}
          </Button>
        </Card>
      ) : null}

      {state.status === "overCapacity" ? (
        <Card className="flex flex-col gap-3 border-critical" data-testid="over-capacity">
          <h2 className="text-section-title font-semibold text-critical">{t("form.overCapacityTitle", { licensed: state.licensed })}</h2>
          <p className="text-[14px]">{t("form.overCapacityBody")}</p>
          <div className="flex flex-col gap-1">
            <label htmlFor="capReason" className="text-[13px] font-medium text-subtle">
              {t("form.capReason")}
            </label>
            <textarea id="capReason" name="capReason" className={area} required minLength={5} maxLength={500} />
          </div>
          <Button className="self-start" disabled={pending} onClick={() => submit({ confirmDuplicate: "1" })} data-testid="send-for-approval">
            {t("form.sendForApproval")}
          </Button>
        </Card>
      ) : null}

      {state.status === "error" ? <Alert>{t.has(`errors.${state.code}`) ? t(`errors.${state.code}` as "errors.unknown") : t("errors.unknown")}</Alert> : null}

      {state.status !== "overCapacity" ? (
        <Button type="submit" disabled={pending} className="self-start" data-testid="save-child">
          {pending ? t("form.saving") : t("form.save")}
        </Button>
      ) : null}
    </form>
  );
}
