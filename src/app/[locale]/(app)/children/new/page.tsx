import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { withUserDb } from "@/db/rls";
import { branchFamilies, branchRooms, visibleBranches } from "@/db/children";
import { waitlistEntry } from "@/db/schema";
import { requireChildren } from "@/lib/require-user";
import { canEditChildren, canEditMedical } from "@/lib/permissions";
import { todayInCairo } from "@/lib/calendar";
import { localName } from "@/lib/i18n-names";
import { PageHeader } from "@/components/settings/Fields";
import { Alert } from "@/components/ui/Alert";
import { BranchTabs, pickBranch } from "@/components/children/BranchTabs";
import { NewChildForm } from "./NewChildForm";

export default async function NewChildPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; waitlist?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireChildren(locale);
  const t = await getTranslations("children");

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => canEditChildren(user, b.id));
    let b = pickBranch(branches, sp.branch);
    let prefill = null;
    if (sp.waitlist && /^[0-9a-f-]{36}$/i.test(sp.waitlist)) {
      const [w] = await tx.select().from(waitlistEntry).where(and(eq(waitlistEntry.id, sp.waitlist), eq(waitlistEntry.status, "waiting")));
      if (w) {
        prefill = w;
        b = branches.find((x) => x.id === w.branchId) ?? b;
      }
    }
    if (!b) return null;
    return { branches, b, rooms: await branchRooms(tx, b.id), families: await branchFamilies(tx, b.id), prefill };
  });
  if (!data) notFound();
  const { branches, b, rooms, families, prefill } = data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("form.title")} help={t("form.help", { branch: localName(b, locale) })} />
      <BranchTabs branches={branches} current={b.id} path="/children/new" locale={locale} label={t("branch")} />
      {prefill ? <Alert tone="good">{t("form.waitlistPrefill")}</Alert> : null}
      <NewChildForm
        branchId={b.id}
        today={todayInCairo()}
        rooms={rooms.map((r) => ({ id: r.id, name: localName(r, locale), band: locale === "ar" ? r.bandNameAr : r.bandNameEn, min: r.minAgeMonths, max: r.maxAgeMonths }))}
        families={families.map((f) => ({ id: f.id, label: `${f.displayName} · ${f.accountNo}` }))}
        canMedical={canEditMedical(user, b.id)}
        prefill={
          prefill
            ? {
                waitlistId: prefill.id,
                name: prefill.studentName,
                dateOfBirth: prefill.dateOfBirth,
                guardianName: prefill.guardianName ?? "",
                guardianPhone: prefill.guardianPhone,
                startDate: prefill.requestedStartMonth,
              }
            : null
        }
      />
    </div>
  );
}
