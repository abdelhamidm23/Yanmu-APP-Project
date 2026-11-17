import { asc, count, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { branch, room } from "@/db/schema";
import { requireSettings } from "@/lib/require-user";
import { localName } from "@/lib/i18n-names";
import { formatNumber } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, PageHeader } from "@/components/settings/Fields";
import { ResultBanner } from "@/components/settings/ResultBanner";
import { createBranch } from "./actions";

export default async function BranchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const user = await requireSettings(locale);
  const t = await getTranslations("settings");
  const rows = await withUserDb(user.id, (tx) =>
    tx
      .select({ id: branch.id, nameAr: branch.nameAr, nameEn: branch.nameEn, code: branch.code, licensed: branch.licensedCapacity, physical: branch.physicalCapacity, isActive: branch.isActive, rooms: count(room.id) })
      .from(branch)
      .leftJoin(room, eq(room.branchId, branch.id))
      .groupBy(branch.id)
      .orderBy(asc(branch.code)),
  );
  const n = (v: number) => formatNumber(v, locale === "en" ? "en" : "ar", user.digits);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("branches.title")} />
      <ResultBanner searchParams={await searchParams} />
      <ul className="flex flex-col gap-3" data-testid="branch-list">
        {rows.map((b) => (
          <li key={b.id}>
            <Link href={`/settings/branches/${b.id}`} className="block rounded-card border border-border bg-surface p-4 hover:bg-bg">
              <div className="flex items-center justify-between gap-3">
                <span className="text-row-title font-semibold">{localName(b, locale)}</span>
                <span className="rounded-chip bg-brand-tint px-2 py-0.5 text-meta font-medium text-brand">{b.code}</span>
              </div>
              <p className="figure mt-1 text-meta text-muted">
                {t("branches.licensedCapacity")}: {n(b.licensed)} · {t("branches.physicalCapacity")}: {n(b.physical)} · {t("branches.roomCount", { count: b.rooms })}
                {b.isActive ? "" : ` · ${t("common.inactive")}`}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      <Card>
        <h2 className="text-section-title font-semibold">{t("branches.addBranch")}</h2>
        <form action={createBranch} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="locale" value={locale} />
          <Field id="nb-nameAr" name="nameAr" label={t("common.nameAr")} dir="rtl" required />
          <Field id="nb-nameEn" name="nameEn" label={t("common.nameEn")} dir="ltr" required />
          <Field id="nb-code" name="code" label={t("branches.code")} dir="ltr" required maxLength={12} />
          <Field id="nb-licensed" name="licensedCapacity" type="number" min={1} defaultValue={100} label={t("branches.licensedCapacity")} required />
          <Field id="nb-physical" name="physicalCapacity" type="number" min={1} defaultValue={200} label={t("branches.physicalCapacity")} required />
          <Field id="nb-licenceNo" name="licenceNo" label={t("branches.licenceNo")} dir="ltr" />
          <Field id="nb-licenceExpiry" name="licenceExpiry" type="date" label={t("branches.licenceExpiry")} />
          <div className="flex items-end">
            <Button type="submit">{t("common.add")}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
