import { getTranslations } from "next-intl/server";
import { withUserDb } from "@/db/rls";
import { visibleBranches, branchRooms } from "@/db/children";
import { attendanceRooms } from "@/db/attendance";
import { childrenForIncident } from "@/db/safety";
import { requireSafety } from "@/lib/require-user";
import { hasRoleIn } from "@/lib/permissions";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/settings/Fields";
import { IncidentForm } from "./IncidentForm";

/** "+ Incident" (spec §8.7, §11.7): the short form. Teachers report for their own classes. */
export default async function NewIncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; room?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireSafety(locale, "report");
  const t = await getTranslations("safety");

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, ["teacher", "front_desk", "branch_manager", "company_manager"], b.id));
    const wide = new Set(branches.filter((b) => hasRoleIn(user, ["front_desk", "branch_manager", "company_manager"], b.id)).map((b) => b.id));
    const rooms: { id: string; name: string; branchId: string }[] = [];
    // Teachers only for their own classes; everyone else for every class of the branch.
    const teacherRooms = await attendanceRooms(tx, user);
    for (const b of branches) {
      const list = wide.has(b.id) ? await branchRooms(tx, b.id) : teacherRooms.filter((r) => r.branchId === b.id);
      for (const r of list) rooms.push({ id: r.id, name: localName(r, locale), branchId: b.id });
    }
    const children: { id: string; name: string; roomId: string; branchId: string }[] = [];
    for (const b of branches) {
      for (const c of await childrenForIncident(tx, b.id, null)) {
        if (!wide.has(b.id) && !rooms.some((r) => r.id === c.roomId)) continue;
        children.push({ id: c.id, name: locale === "ar" ? c.fullNameAr : c.fullNameEn, roomId: c.roomId, branchId: b.id });
      }
    }
    return { branches, wide, rooms, children };
  });
  if (data.branches.length === 0) return <Card>{t("noBranch")}</Card>;
  const defaultBranch = data.branches.find((b) => b.id === sp.branch)?.id ?? data.branches[0].id;
  const defaultRoom = data.rooms.find((r) => r.id === sp.room)?.id ?? null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("form.title")} help={t("form.help")} />
      <Card>
        <IncidentForm
          userId={user.id}
          branches={data.branches.map((b) => ({ id: b.id, name: localName(b, locale) }))}
          rooms={data.rooms}
          kids={data.children}
          defaultBranch={defaultBranch}
          defaultRoom={defaultRoom}
          allowNoRoom={data.wide.has(defaultBranch)}
        />
      </Card>
    </div>
  );
}
