import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { appUser, branch, userBranchRole } from "@/db/schema";
import { requireSettings } from "@/lib/require-user";
import { localName } from "@/lib/i18n-names";
import { todayInCairo } from "@/lib/calendar";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { ResultBanner } from "@/components/settings/ResultBanner";

export default async function UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const user = await requireSettings(locale);
  const t = await getTranslations();
  const { users, grants, branches } = await withUserDb(user.id, async (tx) => ({
    users: await tx.select().from(appUser).orderBy(asc(appUser.name)),
    grants: await tx.select().from(userBranchRole),
    branches: await tx.select().from(branch),
  }));
  const branchName = new Map(branches.map((b) => [b.id, localName(b, locale)]));
  const today = todayInCairo();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("settings.users.title")}>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/export/users?locale=${locale}`} className={buttonClasses("secondary")} download>
            {t("settings.common.exportExcel")}
          </a>
          <Link href="/settings/users/new" className={buttonClasses("primary")}>
            {t("settings.users.addUser")}
          </Link>
        </div>
      </PageHeader>
      <ResultBanner searchParams={await searchParams} />
      <ul className="flex flex-col divide-y divide-divider rounded-card border border-border bg-surface" data-testid="user-list">
        {users.map((u) => {
          const mine = grants.filter((g) => g.userId === u.id);
          const ended = u.endDate !== null && u.endDate <= today;
          return (
            <li key={u.id}>
              <Link href={`/settings/users/${u.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-bg">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-row-title font-semibold">{u.name}</span>
                  {ended ? (
                    <span className="rounded-chip bg-provisional-bg px-2 py-0.5 text-meta text-subtle">{t("settings.users.statusEnded")}</span>
                  ) : null}
                </span>
                <span className="text-meta text-muted" dir="ltr">
                  {u.email}
                </span>
                <span className="text-meta text-subtle">
                  {mine.length === 0
                    ? t("settings.users.noRoles")
                    : mine
                        .map((g) => `${t(`roles.${g.role}`)} · ${g.branchId ? branchName.get(g.branchId) : t("settings.common.allBranches")}`)
                        .join("، ")}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
