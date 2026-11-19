import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { branchDirectory, branchRooms } from "@/db/children";
import { approvalRequest, consentRecord, enrollment, family, guardian, pickupCard, room, student, studentGuardian, studentMedical } from "@/db/schema";
import { PickupCardControl } from "./PickupCardControl";
import { requireChildren } from "@/lib/require-user";
import { canBreakGlass, canEditChildren, canEditMedical } from "@/lib/permissions";
import { CONSENT_PURPOSES, RELATIONSHIPS, WITHDRAW_REASONS, ageInMonths, childAlerts } from "@/lib/children";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber, formatPlainDate } from "@/lib/format";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CheckField, Field, SelectField } from "@/components/settings/Fields";
import { Flag } from "@/components/children/BranchTabs";
import { ChildResult } from "@/components/children/ChildResult";
import { BreakGlassForm } from "./BreakGlassForm";
import { addConsent, addGuardian, moveRoom, requestTransfer, saveMedical, setPickUp, updateChild, withdrawChild, withdrawConsent } from "./actions";

const area = "min-h-20 w-full rounded-button border border-outline bg-surface px-3 py-2 text-[15px]";

function Hidden({ locale, studentId }: { locale: string; studentId: string }) {
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="studentId" value={studentId} />
    </>
  );
}

export default async function ChildPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireChildren(locale);
  const t = await getTranslations("children");
  const loc = locale === "en" ? "en" : "ar";
  const n = (v: number) => formatNumber(v, loc, user.digits);
  const d = (iso: string) => formatPlainDate(iso, loc, user.digits);
  const today = todayInCairo();

  const data = await withUserDb(user.id, async (tx) => {
    const [s] = await tx.select().from(student).where(eq(student.id, id));
    if (!s) return null;
    const [fam] = await tx.select().from(family).where(eq(family.id, s.familyId));
    const guardians = await tx
      .select({ id: guardian.id, fullName: guardian.fullName, relationship: guardian.relationship, phone: guardian.phone, photo: guardian.photoAttachmentId, canPickUp: studentGuardian.canPickUp, primary: studentGuardian.isPrimaryContact })
      .from(studentGuardian)
      .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
      .where(eq(studentGuardian.studentId, id))
      .orderBy(desc(studentGuardian.isPrimaryContact), asc(guardian.fullName));
    const cards = guardians.length
      ? await tx
          .select({ guardianId: pickupCard.guardianId, since: pickupCard.createdAt })
          .from(pickupCard)
          .where(and(inArray(pickupCard.guardianId, guardians.map((g) => g.id)), isNull(pickupCard.revokedAt)))
      : [];
    const [medical] = await tx.select().from(studentMedical).where(eq(studentMedical.studentId, id));
    const consents = await tx.select().from(consentRecord).where(eq(consentRecord.studentId, id)).orderBy(desc(consentRecord.grantedOn));
    const enrollments = await tx
      .select({ e: enrollment, roomAr: room.nameAr, roomEn: room.nameEn })
      .from(enrollment)
      .leftJoin(room, eq(room.id, enrollment.roomId))
      .where(eq(enrollment.studentId, id))
      .orderBy(desc(enrollment.startDate), desc(enrollment.createdAt));
    const requests = await tx
      .select()
      .from(approvalRequest)
      .where(and(eq(approvalRequest.studentId, id), eq(approvalRequest.status, "pending")));
    return { s, fam, guardians, cards, medical, consents, enrollments, requests, rooms: await branchRooms(tx, s.branchId), directory: await branchDirectory(tx) };
  });
  if (!data) notFound();
  const { s, fam, guardians, cards, medical, consents, enrollments, requests, rooms, directory } = data;

  const canEdit = canEditChildren(user, s.branchId);
  const medicalEditor = canEditMedical(user, s.branchId);
  const breakGlass = canBreakGlass(user, s.branchId) && !medicalEditor;
  const open = enrollments.find((r) => r.e.status === "active" || r.e.status === "pending_approval");
  const openRoom = open ? rooms.find((r) => r.id === open.e.roomId) : undefined;
  const months = ageInMonths(s.dateOfBirth, today);
  const alerts = childAlerts(s.dateOfBirth, openRoom ? { maxAgeMonths: openRoom.maxAgeMonths } : null, today);
  const hasRecords = consents.some((c) => c.purpose === "records" && !c.withdrawnOn);
  const branchName = (bid: string | null) => {
    const b = directory.find((x) => x.id === bid);
    return b ? localName(b, locale) : "—";
  };
  const transfer = requests.find((r) => r.type === "transfer");
  const name = locale === "ar" ? s.fullNameAr : s.fullNameEn;
  const otherName = locale === "ar" ? s.fullNameEn : s.fullNameAr;

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/children?branch=${s.branchId}`} className="text-[14px] text-brand underline">
        {t("backToList")}
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-page-title font-semibold" data-testid="child-name">{name}</h1>
        <p className="text-muted" lang={locale === "ar" ? "en" : "ar"}>{otherName}</p>
        <p className="figure text-meta text-subtle">
          {s.studentNo} · {t("age", { years: n(Math.floor(months / 12)), months: n(months % 12) })} · {branchName(s.branchId)}
          {open ? ` · ${locale === "ar" ? open.roomAr : open.roomEn}` : ""}
        </p>
        <div className="flex flex-wrap gap-1">
          <Flag tone={s.status === "active" ? "good" : s.status === "pending" ? "attention" : "neutral"} testId="child-status">
            {t(`status.${s.status as "active"}`)}
          </Flag>
          {!hasRecords ? <Flag tone="critical" testId="flag-no-consent">{t("flags.noConsent")}</Flag> : null}
          {alerts.movingUpOn ? <Flag tone="neutral">{t("flags.movingUp", { date: d(alerts.movingUpOn) })}</Flag> : null}
          {alerts.leavingOn ? <Flag tone="attention">{t("flags.leaving", { date: d(alerts.leavingOn) })}</Flag> : null}
          {s.isDemo ? <Flag tone="neutral">{t("flags.demo")}</Flag> : null}
        </div>
      </header>
      <ChildResult searchParams={await searchParams} />

      {requests.map((r) => (
        <Card key={r.id} className="border-attention text-[14px]" data-testid="pending-request">
          {r.type === "transfer" ? t("detail.transferPending", { branch: branchName(r.toBranchId) }) : t("detail.overCapacityPending")}
        </Card>
      ))}

      {!hasRecords ? (
        <Card className="border-critical text-[14px] text-critical">{t("detail.consentMissing")}</Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <h2 className="text-section-title font-semibold">{t("detail.guardians")}</h2>
        <p className="text-meta text-muted">
          {t("detail.family")}: {fam?.displayName} · <span className="figure">{fam?.accountNo}</span>
        </p>
        <ul className="flex flex-col divide-y divide-border" data-testid="guardian-list">
          {guardians.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-col">
                <span className="font-medium">
                  {g.fullName} <span className="text-meta text-muted">· {t(`relationship.${g.relationship as "mother"}`)}</span>
                </span>
                <a href={`tel:${g.phone}`} className="figure text-[14px] text-brand" dir="ltr">
                  {g.phone}
                </a>
                {g.photo ? (
                  <a href={`/api/attachment/${g.photo}`} className="text-meta text-brand underline" target="_blank" rel="noreferrer">
                    {t("detail.viewPhoto")}
                  </a>
                ) : null}
              </span>
              <span className="flex items-center gap-2">
                <Flag tone={g.canPickUp ? "good" : "neutral"}>{g.canPickUp ? t("detail.pickUpYes") : t("detail.pickUpNo")}</Flag>
                {canEdit ? (
                  <form action={setPickUp}>
                    <Hidden locale={locale} studentId={id} />
                    <input type="hidden" name="guardianId" value={g.id} />
                    <input type="hidden" name="canPickUp" value={g.canPickUp ? "false" : "true"} />
                    <button type="submit" className="min-h-11 px-2 text-[14px] text-brand underline">
                      {g.canPickUp ? t("detail.stopPickUp") : t("detail.allowPickUp")}
                    </button>
                  </form>
                ) : null}
              </span>
              {g.canPickUp && canEdit ? (
                <div className="basis-full">
                  <PickupCardControl
                    locale={locale}
                    studentId={id}
                    guardianId={g.id}
                    adultName={g.fullName}
                    branchName={branchName(s.branchId)}
                    inUseSince={(() => {
                      const c = cards.find((x) => x.guardianId === g.id);
                      return c ? d(todayInCairo(c.since)) : null;
                    })()}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-medium text-brand">{t("detail.addGuardian")}</summary>
            <form action={addGuardian} className="mt-2 grid gap-3 sm:grid-cols-2">
              <Hidden locale={locale} studentId={id} />
              <Field id="ag-name" name="fullName" label={t("form.fullName")} required />
              <SelectField id="ag-rel" name="relationship" label={t("form.relationship")} options={RELATIONSHIPS.map((r) => ({ value: r, label: t(`relationship.${r}`) }))} />
              <Field id="ag-phone" name="phone" type="tel" dir="ltr" label={t("form.phone")} hint={t("form.phoneHint")} required />
              <Field id="ag-id" name="idLast4" inputMode="numeric" dir="ltr" maxLength={4} label={t("form.idLast4")} />
              <Field id="ag-photo" name="photo" type="file" accept="image/*" label={t("form.photo")} />
              <CheckField name="canPickUp" label={t("form.canPickUp")} defaultChecked />
              <Button type="submit" className="self-start">{t("detail.addGuardian")}</Button>
            </form>
          </details>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3" data-testid="medical">
        <h2 className="text-section-title font-semibold">{t("detail.medical")}</h2>
        {medicalEditor ? (
          <form action={saveMedical} className="flex flex-col gap-3">
            <Hidden locale={locale} studentId={id} />
            <p className="text-meta text-muted">{t("form.medicalHelp")}</p>
            {(["allergies", "conditions", "medications", "doctorContact"] as const).map((k) => (
              <div key={k} className="flex flex-col gap-1">
                <label htmlFor={`m-${k}`} className="text-[13px] font-medium text-subtle">
                  {t(`medical.${k}`)}
                </label>
                <textarea id={`m-${k}`} name={k} className={area} defaultValue={medical?.[k] ?? ""} maxLength={500} />
              </div>
            ))}
            <Button type="submit" className="self-start">{t("detail.saveMedical")}</Button>
          </form>
        ) : medical ? (
          <dl className="flex flex-col gap-2 text-[14px]">
            {(["allergies", "conditions", "medications", "doctorContact"] as const).map((k) =>
              medical[k] ? (
                <div key={k}>
                  <dt className="text-muted">{t(`medical.${k}`)}</dt>
                  <dd className="whitespace-pre-line">{medical[k]}</dd>
                </div>
              ) : null,
            )}
          </dl>
        ) : breakGlass ? (
          <BreakGlassForm studentId={id} />
        ) : (
          <p className="text-[14px] text-muted" data-testid="medical-restricted">{t("detail.medicalRestricted")}</p>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-section-title font-semibold">{t("detail.consents")}</h2>
        {consents.length === 0 ? <p className="text-[14px] text-muted">{t("detail.consentNone")}</p> : null}
        <ul className="flex flex-col divide-y divide-border">
          {consents.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
              <span className="flex flex-col">
                <span className="font-medium">{t(`purpose.${c.purpose as "records"}`)}</span>
                <span className="figure text-meta text-muted">
                  {c.withdrawnOn ? t("detail.consentWithdrawn", { date: d(c.withdrawnOn) }) : t("detail.consentGranted", { date: d(c.grantedOn) })}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {c.formAttachmentId ? (
                  <a href={`/api/attachment/${c.formAttachmentId}`} target="_blank" rel="noreferrer" className="text-brand underline">
                    {t("detail.viewForm")}
                  </a>
                ) : null}
                {canEdit && !c.withdrawnOn ? (
                  <form action={withdrawConsent}>
                    <Hidden locale={locale} studentId={id} />
                    <input type="hidden" name="consentId" value={c.id} />
                    <button type="submit" className="min-h-11 px-2 text-brand underline">
                      {t("detail.withdrawConsent")}
                    </button>
                  </form>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {canEdit ? (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-medium text-brand">{t("detail.addConsent")}</summary>
            <form action={addConsent} className="mt-2 grid gap-3 sm:grid-cols-2">
              <Hidden locale={locale} studentId={id} />
              <SelectField id="ac-purpose" name="purpose" label={t("detail.purpose")} options={CONSENT_PURPOSES.map((p) => ({ value: p, label: t(`purpose.${p}`) }))} />
              <SelectField id="ac-guardian" name="guardianId" label={t("detail.signedBy")} options={guardians.map((g) => ({ value: g.id, label: g.fullName }))} />
              <Field id="ac-date" name="grantedOn" type="date" label={t("detail.signedOn")} defaultValue={today} max={today} required />
              <Field id="ac-scan" name="scan" type="file" accept="image/*,application/pdf" label={t("form.consentScan")} />
              <Button type="submit" className="self-start">{t("detail.saveConsent")}</Button>
            </form>
          </details>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-section-title font-semibold">{t("detail.history")}</h2>
        <ul className="flex flex-col gap-2 text-[14px]" data-testid="enrollment-history">
          {enrollments.map(({ e, roomAr, roomEn }) => (
            <li key={e.id} className="flex flex-col">
              <span className="font-medium">
                {branchName(e.branchId)}
                {roomEn ? ` · ${locale === "ar" ? roomAr : roomEn}` : ""} · {t(`status.${e.status as "active"}`)}
              </span>
              <span className="figure text-meta text-muted">
                {t("detail.from", { date: d(e.startDate) })}
                {e.endDate ? ` ${t("detail.until", { date: d(e.endDate) })}` : ""}
                {e.endReason ? ` · ${t.has(`withdrawReason.${e.endReason.split(":")[0]}`) ? t(`withdrawReason.${e.endReason.split(":")[0]}` as "withdrawReason.other") : e.endReason}` : ""}
              </span>
              {e.bandOverrideReason ? <span className="text-meta text-muted">{t("detail.bandReason", { reason: e.bandOverrideReason })}</span> : null}
            </li>
          ))}
        </ul>
      </Card>

      {canEdit && open ? (
        <>
          <Card className="flex flex-col gap-3">
            <h2 className="text-section-title font-semibold">{t("detail.edit")}</h2>
            <form action={updateChild} className="grid gap-3 sm:grid-cols-2">
              <Hidden locale={locale} studentId={id} />
              <Field id="ed-ar" name="fullNameAr" dir="rtl" label={t("nameAr")} defaultValue={s.fullNameAr} required />
              <Field id="ed-en" name="fullNameEn" dir="ltr" label={t("nameEn")} defaultValue={s.fullNameEn} required />
              <Field id="ed-dob" name="dateOfBirth" type="date" label={t("dob")} defaultValue={s.dateOfBirth} max={today} required />
              <SelectField id="ed-g" name="gender" label={t("genderLabel")} defaultValue={s.gender} options={[{ value: "female", label: t("gender.female") }, { value: "male", label: t("gender.male") }]} />
              <Button type="submit" className="self-start">{t("detail.saveDetails")}</Button>
            </form>
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-section-title font-semibold">{t("detail.moveRoom")}</h2>
            <form action={moveRoom} className="grid gap-3 sm:grid-cols-2" data-testid="move-room">
              <Hidden locale={locale} studentId={id} />
              <SelectField id="mv-room" name="roomId" label={t("room")} defaultValue={open.e.roomId} options={rooms.map((r) => ({ value: r.id, label: `${localName(r, locale)} · ${locale === "ar" ? r.bandNameAr : r.bandNameEn}` }))} />
              <Field id="mv-reason" name="bandReason" label={t("detail.bandReasonLabel")} hint={t("detail.bandReasonHint")} />
              <Button type="submit" variant="secondary" className="self-start">{t("detail.move")}</Button>
            </form>
          </Card>

          {!transfer && directory.length > 1 ? (
            <Card className="flex flex-col gap-3">
              <h2 className="text-section-title font-semibold">{t("detail.transfer")}</h2>
              <p className="text-meta text-muted">{t("detail.transferHelp")}</p>
              <form action={requestTransfer} className="grid gap-3 sm:grid-cols-2" data-testid="transfer-form">
                <Hidden locale={locale} studentId={id} />
                <SelectField id="tr-branch" name="toBranchId" label={t("branch")} options={directory.filter((b) => b.id !== s.branchId).map((b) => ({ value: b.id, label: localName(b, locale) }))} />
                <Field id="tr-reason" name="reason" label={t("detail.reason")} required minLength={3} />
                <Button type="submit" variant="secondary" className="self-start">{t("detail.requestTransfer")}</Button>
              </form>
            </Card>
          ) : null}

          {open.e.status === "active" ? (
            <Card className="flex flex-col gap-3">
              <h2 className="text-section-title font-semibold">{t("detail.withdraw")}</h2>
              <p className="text-meta text-muted">{t("detail.withdrawHelp")}</p>
              <form action={withdrawChild} className="grid gap-3 sm:grid-cols-2" data-testid="withdraw-form">
                <Hidden locale={locale} studentId={id} />
                <Field id="wd-day" name="lastDay" type="date" label={t("detail.lastDay")} defaultValue={today} required />
                <SelectField id="wd-reason" name="reason" label={t("detail.reason")} options={[...WITHDRAW_REASONS, "graduated" as const].map((r) => ({ value: r, label: t(`withdrawReason.${r}`) }))} />
                <Field id="wd-note" name="note" label={t("detail.note")} />
                <Button type="submit" variant="danger" className="self-start">{t("detail.confirmWithdraw")}</Button>
              </form>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
