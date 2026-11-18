import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { branchRooms, visibleBranches } from "@/db/children";
import { requireArea } from "@/lib/require-user";
import { canEditStaff } from "@/lib/permissions";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/settings/Fields";
import { ResultBanner } from "@/components/settings/ResultBanner";
import { Alert } from "@/components/ui/Alert";
import { StaffForm } from "../StaffForm";

export default async function NewStaffPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ branch?: string; ok?: string; error?: string }> }) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireArea(locale, "staff");
  const t = await getTranslations("staff");
  const data = await withUserDb(user.id, async (tx) => {
    const b = (await visibleBranches(tx)).find((x) => x.id === sp.branch && canEditStaff(user, x.id));
    if (!b) return null;
    return { b, rooms: await branchRooms(tx, b.id) };
  });
  if (!data) notFound();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("add")} help={localName(data.b, locale)}>
        <Link href={`/staff?branch=${data.b.id}`} className="text-brand underline">
          {t("backToList")}
        </Link>
      </PageHeader>
      {sp.error === "noAccount" ? <Alert>{t("form.noAccount")}</Alert> : <ResultBanner searchParams={sp} />}
      <Card>
        <StaffForm locale={locale} branchId={data.b.id} rooms={data.rooms.map((r) => ({ id: r.id, name: localName(r, locale) }))} values={null} readOnly={false} />
      </Card>
    </div>
  );
}
