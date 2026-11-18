import { getTranslations } from "next-intl/server";
import { and, asc, eq } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { room, staff } from "@/db/schema";
import { requireArea } from "@/lib/require-user";
import { canEditStaff, hasRoleIn, STAFF_VIEW_ROLES } from "@/lib/permissions";
import { formatNumber } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";

/** Staff list per branch (spec §5 "Staff records"). */
export default async function StaffPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ branch?: string; show?: string }> }) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireArea(locale, "staff");
  const t = await getTranslations("staff");
  const loc = locale === "en" ? "en" : "ar";
  const left = sp.show === "left";

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, STAFF_VIEW_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const people = await tx
      .select({
        id: staff.id,
        fullNameAr: staff.fullNameAr,
        fullNameEn: staff.fullNameEn,
        jobTitle: staff.jobTitle,
        isQualifiedCarer: staff.isQualifiedCarer,
        no: staff.deviceEmployeeNo,
        roomAr: room.nameAr,
        roomEn: room.nameEn,
      })
      .from(staff)
      .leftJoin(room, eq(room.id, staff.defaultRoomId))
      .where(and(eq(staff.branchId, b.id), eq(staff.status, left ? "left" : "active")))
      .orderBy(asc(staff.fullNameEn));
    return { branches, b, people };
  });
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("title")} />
        <Card>{t("noBranch")}</Card>
      </div>
    );
  }
  const { branches, b, people } = data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")}>
        {canEditStaff(user, b.id) ? (
          <Link href={`/staff/new?branch=${b.id}`} className={buttonClasses("primary")} data-testid="add-staff">
            {t("add")}
          </Link>
        ) : null}
      </PageHeader>
      <BranchTabs branches={branches} current={b.id} path="/staff" locale={locale} label={t("branch")} />
      <nav className="flex flex-wrap gap-2">
        <Link href={`/staff?branch=${b.id}`} aria-current={!left ? "page" : undefined} className={!left ? "font-semibold text-brand" : "text-brand underline"}>
          {t("current")}
        </Link>
        <Link href={`/staff?branch=${b.id}&show=left`} aria-current={left ? "page" : undefined} className={left ? "font-semibold text-brand" : "text-brand underline"}>
          {t("left")}
        </Link>
        <a href={`/api/export/staff?branch=${b.id}&locale=${loc}`} className="ms-auto text-brand underline" data-testid="export-staff">
          {t("export")}
        </a>
      </nav>
      <p className="figure text-meta text-muted">{t("count", { count: people.length, n: formatNumber(people.length, loc, user.digits) })}</p>
      {people.length === 0 ? <Card>{t("empty")}</Card> : null}
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="staff-list">
        {people.map((p) => (
          <li key={p.id}>
            <Link href={`/staff/${p.id}`} className="flex min-h-14 flex-col gap-1 px-4 py-3 hover:bg-bg">
              <span className="text-row-title font-semibold">{locale === "ar" ? p.fullNameAr : p.fullNameEn}</span>
              <span className="flex flex-wrap items-center gap-2 text-meta text-subtle">
                {p.jobTitle}
                {p.roomEn ? ` · ${locale === "ar" ? p.roomAr : p.roomEn}` : ""}
                {!p.no ? <Flag tone="attention">{t("noDeviceNo")}</Flag> : null}
                {!p.isQualifiedCarer ? <Flag tone="neutral">{t("notCarer")}</Flag> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
