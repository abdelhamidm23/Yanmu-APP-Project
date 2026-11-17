import { asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { AUDITED_TABLES, auditNames, readAudit } from "@/db/audit";
import { ageBand, appUser, branch, room, userBranchRole } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { isOrgAdmin } from "@/lib/permissions";
import { localName } from "@/lib/i18n-names";
import { auditChanges } from "@/lib/audit-diff";
import { auditFormatter } from "@/lib/audit-format";
import { formatTimestamp } from "@/lib/format";
import { todayInCairo } from "@/lib/calendar";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";

const notFound = () => new Response("Not found", { status: 404 });

/** Excel export for settings lists (CLAUDE.md rule 13). Org admins only; RLS applies to every query. */
export async function GET(req: Request, { params }: { params: Promise<{ list: string }> }) {
  const { list } = await params;
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") === "en" ? "en" : "ar";
  const user = await getCurrentUser();
  if (!user || user.mustSetUpMfa || !isOrgAdmin(user)) return notFound();
  const t = await getTranslations({ locale });
  const stamp = todayInCairo();

  if (list === "users") {
    const { users, grants, branches } = await withUserDb(user.id, async (tx) => ({
      users: await tx.select().from(appUser).orderBy(asc(appUser.name)),
      grants: await tx.select().from(userBranchRole),
      branches: await tx.select().from(branch),
    }));
    const branchName = new Map(branches.map((b) => [b.id, localName(b, locale)]));
    const rows = users.map((u) => [
      u.name,
      u.email,
      u.phone ?? "",
      grants
        .filter((g) => g.userId === u.id)
        .map((g) => `${t(`roles.${g.role}`)} · ${g.branchId ? (branchName.get(g.branchId) ?? "") : t("settings.common.allBranches")}`)
        .join("\n"),
      u.endDate !== null && u.endDate <= stamp ? t("settings.users.statusEnded") : t("settings.users.statusActive"),
      u.endDate ?? "",
      u.twoFactorEnabled ? t("settings.users.mfaOn") : t("settings.users.mfaOff"),
    ]);
    const cols = ["name", "email", "phone", "roles", "status", "endDate", "mfa"].map((k) => ({ header: t(`settings.users.${k as "name"}`), width: k === "roles" ? 40 : 22 }));
    return xlsxResponse(await buildWorkbook(t("settings.users.title"), cols, rows, locale), `users-${stamp}.xlsx`);
  }

  if (list === "rooms") {
    const branchId = z.uuid().safeParse(url.searchParams.get("branch"));
    if (!branchId.success) return notFound();
    const data = await withUserDb(user.id, async (tx) => {
      const [b] = await tx.select().from(branch).where(eq(branch.id, branchId.data));
      if (!b) return null;
      const rooms = await tx
        .select({ room, band: ageBand })
        .from(room)
        .innerJoin(ageBand, eq(ageBand.id, room.ageBandId))
        .where(eq(room.branchId, b.id))
        .orderBy(asc(room.nameEn));
      return { b, rooms };
    });
    if (!data) return notFound();
    const rows = data.rooms.map(({ room: r, band }) => [
      r.nameAr,
      r.nameEn,
      localName(band, locale),
      r.capacity,
      r.isActive ? t("settings.common.active") : t("settings.common.inactive"),
    ]);
    const cols = [
      { header: t("settings.common.nameAr") },
      { header: t("settings.common.nameEn") },
      { header: t("settings.rooms.ageBand") },
      { header: t("settings.rooms.capacity"), width: 12 },
      { header: t("settings.users.status"), width: 14 },
    ];
    return xlsxResponse(await buildWorkbook(localName(data.b, locale), cols, rows, locale), `rooms-${data.b.code}-${stamp}.xlsx`);
  }

  if (list === "audit") {
    const table = z.enum(AUDITED_TABLES).optional().catch(undefined).parse(url.searchParams.get("table") || undefined);
    const { rows, names } = await withUserDb(user.id, async (tx) => ({ ...(await readAudit(tx, { table, limit: 10000 })), names: await auditNames(tx, locale) }));
    const readable = auditFormatter(t as never, (k) => t.has(k as never), names);
    const out = rows.map((r) => [
      formatTimestamp(r.at, locale, "latin"),
      r.actorName ?? t("settings.audit.system"),
      `${t(`settings.audit.actions.${r.action as "insert"}`)} · ${t(`settings.audit.tables.${r.tableName as "branch"}`)}`,
      auditChanges(r.action, r.before, r.after)
        .map(readable)
        .map((c) => (c.from !== undefined ? `${c.field}: ${c.from} → ${c.to}` : `${c.field}: ${c.to}`))
        .join("\n"),
      r.reason ?? "",
    ]);
    const cols = [
      { header: t("settings.audit.when"), width: 20 },
      { header: t("settings.audit.who") },
      { header: t("settings.audit.what"), width: 24 },
      { header: t("settings.audit.changes"), width: 60 },
      { header: t("settings.common.note"), width: 30 },
    ];
    return xlsxResponse(await buildWorkbook(t("settings.audit.title"), cols, out, locale), `audit-${stamp}.xlsx`);
  }

  return notFound();
}
