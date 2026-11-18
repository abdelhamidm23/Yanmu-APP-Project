import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { branchRooms } from "@/db/children";
import { appUser, staff } from "@/db/schema";
import { requireArea } from "@/lib/require-user";
import { canEditStaff } from "@/lib/permissions";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/settings/Fields";
import { ResultBanner } from "@/components/settings/ResultBanner";
import { localName } from "@/lib/i18n-names";
import { StaffForm } from "../StaffForm";

export default async function StaffRecordPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { locale, id } = await params;
  const sp = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const user = await requireArea(locale, "staff");
  const t = await getTranslations("staff");
  const data = await withUserDb(user.id, async (tx) => {
    const [s] = await tx.select().from(staff).where(eq(staff.id, id));
    if (!s) return null;
    const [u] = s.userId ? await tx.select({ email: appUser.email }).from(appUser).where(eq(appUser.id, s.userId)) : [];
    return { s, email: u?.email ?? null, rooms: await branchRooms(tx, s.branchId) };
  });
  if (!data) notFound();
  const { s } = data;
  const editable = canEditStaff(user, s.branchId);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={locale === "ar" ? s.fullNameAr : s.fullNameEn} help={s.jobTitle}>
        <Link href={`/staff?branch=${s.branchId}`} className="text-brand underline">
          {t("backToList")}
        </Link>
      </PageHeader>
      {sp.error === "noAccount" ? <Alert>{t("form.noAccount")}</Alert> : <ResultBanner searchParams={sp} />}
      <Card>
        <StaffForm
          locale={locale}
          branchId={s.branchId}
          rooms={data.rooms.map((r) => ({ id: r.id, name: localName(r, locale) }))}
          values={{ ...s, email: data.email }}
          readOnly={!editable}
        />
      </Card>
      <Link href={`/staff-attendance?branch=${s.branchId}`} className="text-brand underline">
        {t("attendanceLink")}
      </Link>
    </div>
  );
}
