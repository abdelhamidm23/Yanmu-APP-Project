import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { ageBand, branch, room } from "@/db/schema";
import { requireSettings } from "@/lib/require-user";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { CheckField, Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { ResultBanner } from "@/components/settings/ResultBanner";
import { createRoom, updateBranch, updateRoom } from "../actions";

export default async function BranchDetail({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const user = await requireSettings(locale);
  const t = await getTranslations("settings");

  const data = await withUserDb(user.id, async (tx) => {
    const [b] = await tx.select().from(branch).where(eq(branch.id, id));
    if (!b) return null;
    const rooms = await tx.select().from(room).where(eq(room.branchId, id)).orderBy(asc(room.nameEn));
    const bands = await tx.select().from(ageBand).orderBy(asc(ageBand.sort));
    return { b, rooms, bands };
  });
  if (!data) notFound();
  const { b, rooms, bands } = data;
  const bandOptions = bands.map((x) => ({ value: x.id, label: localName(x, locale) }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={localName(b, locale)}>
        <a href={`/api/export/rooms?branch=${b.id}&locale=${locale}`} className={buttonClasses("secondary")} download>
          {t("common.exportExcel")}
        </a>
      </PageHeader>
      <ResultBanner searchParams={await searchParams} />

      <Card>
        <h2 className="text-section-title font-semibold">{t("branches.details")}</h2>
        <form action={updateBranch} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={b.id} />
          <Field id="b-nameAr" name="nameAr" label={t("common.nameAr")} defaultValue={b.nameAr} dir="rtl" required />
          <Field id="b-nameEn" name="nameEn" label={t("common.nameEn")} defaultValue={b.nameEn} dir="ltr" required />
          <Field id="b-code" name="code" label={t("branches.code")} defaultValue={b.code} dir="ltr" required />
          <Field id="b-licensed" name="licensedCapacity" type="number" min={1} label={t("branches.licensedCapacity")} defaultValue={b.licensedCapacity} required />
          <Field id="b-physical" name="physicalCapacity" type="number" min={1} label={t("branches.physicalCapacity")} defaultValue={b.physicalCapacity} required />
          <Field id="b-licenceNo" name="licenceNo" label={t("branches.licenceNo")} defaultValue={b.licenceNo ?? ""} dir="ltr" />
          <Field id="b-licenceExpiry" name="licenceExpiry" type="date" label={t("branches.licenceExpiry")} defaultValue={b.licenceExpiry ?? ""} />
          <CheckField name="isActive" label={t("branches.isActive")} defaultChecked={b.isActive} />
          <div className="sm:col-span-2">
            <Button type="submit">{t("common.save")}</Button>
          </div>
        </form>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-section-title font-semibold">{t("rooms.title")}</h2>
        {rooms.length === 0 ? <p className="text-muted">{t("common.none")}</p> : null}
        <ul className="flex flex-col gap-3" data-testid="room-list">
          {rooms.map((r) => (
            <li key={r.id}>
              <Card>
                <form action={updateRoom} className="grid gap-3 sm:grid-cols-2" aria-label={localName(r, locale)}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="branchId" value={b.id} />
                  <input type="hidden" name="id" value={r.id} />
                  <Field id={`r-${r.id}-ar`} name="nameAr" label={t("common.nameAr")} defaultValue={r.nameAr} dir="rtl" required />
                  <Field id={`r-${r.id}-en`} name="nameEn" label={t("common.nameEn")} defaultValue={r.nameEn} dir="ltr" required />
                  <SelectField id={`r-${r.id}-band`} name="ageBandId" label={t("rooms.ageBand")} options={bandOptions} defaultValue={r.ageBandId} />
                  <Field id={`r-${r.id}-cap`} name="capacity" type="number" min={1} label={t("rooms.capacity")} defaultValue={r.capacity} required />
                  <CheckField name="isActive" label={t("rooms.isActive")} defaultChecked={r.isActive} />
                  <div className="flex items-end">
                    <Button type="submit" variant="secondary">
                      {t("common.save")}
                    </Button>
                  </div>
                </form>
              </Card>
            </li>
          ))}
        </ul>
        <Card>
          <h3 className="text-row-title font-semibold">{t("rooms.addRoom")}</h3>
          <form action={createRoom} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="add-room">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="branchId" value={b.id} />
            <Field id="nr-ar" name="nameAr" label={t("common.nameAr")} dir="rtl" required />
            <Field id="nr-en" name="nameEn" label={t("common.nameEn")} dir="ltr" required />
            <SelectField id="nr-band" name="ageBandId" label={t("rooms.ageBand")} options={bandOptions} />
            <Field id="nr-cap" name="capacity" type="number" min={1} label={t("rooms.capacity")} hint={t("rooms.capacityHint")} required />
            <div className="sm:col-span-2">
              <Button type="submit">{t("rooms.addRoom")}</Button>
            </div>
          </form>
        </Card>
      </section>
    </div>
  );
}
