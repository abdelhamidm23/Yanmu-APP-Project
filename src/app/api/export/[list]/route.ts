import { and, asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { AUDITED_TABLES, auditNames, readAudit } from "@/db/audit";
import { ageBand, appUser, branch, room, staff, staffAttendanceDay, userBranchRole, waitlistEntry } from "@/db/schema";
import { childList } from "@/db/children";
import { getCurrentUser } from "@/lib/session";
import { canViewChildren, canViewStaff, canViewStaffAttendance, canViewWaitlist, isOrgAdmin } from "@/lib/permissions";
import { ageInMonths } from "@/lib/children";
import { localName } from "@/lib/i18n-names";
import { auditChanges } from "@/lib/audit-diff";
import { auditFormatter } from "@/lib/audit-format";
import { formatTimestamp } from "@/lib/format";
import { cairoTimeOf, todayInCairo } from "@/lib/calendar";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";
import { MONEY_LISTS, moneyExport } from "@/db/money-export";

const notFound = () => new Response("Not found", { status: 404 });

/** Excel export for settings lists (CLAUDE.md rule 13). Org admins only; RLS applies to every query. */
export async function GET(req: Request, { params }: { params: Promise<{ list: string }> }) {
  const { list } = await params;
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") === "en" ? "en" : "ar";
  const user = await getCurrentUser();
  if (!user || user.mustSetUpMfa) return notFound();
  const t = await getTranslations({ locale });
  const stamp = todayInCairo();

  // Money lists (Phase 4).
  if ((MONEY_LISTS as readonly string[]).includes(list)) return (await moneyExport(list, url, user, t, locale, stamp)) ?? notFound();

  // Staff and their attendance days (spec §8.3). Row-level security limits the rows.
  if (list === "staff" || list === "staff-days") {
    const branchId = z.uuid().safeParse(url.searchParams.get("branch"));
    const day = z.iso.date().safeParse(url.searchParams.get("date") ?? stamp);
    if (!branchId.success || !day.success || !(list === "staff" ? canViewStaff(user) : canViewStaffAttendance(user))) return notFound();
    const data = await withUserDb(user.id, async (tx) => {
      const [b] = await tx.select().from(branch).where(eq(branch.id, branchId.data));
      if (!b) return null;
      const people = await tx
        .select({ s: staff, roomAr: room.nameAr, roomEn: room.nameEn, d: staffAttendanceDay })
        .from(staff)
        .leftJoin(room, eq(room.id, staff.defaultRoomId))
        .leftJoin(staffAttendanceDay, and(eq(staffAttendanceDay.staffId, staff.id), eq(staffAttendanceDay.date, day.data)))
        .where(list === "staff" ? eq(staff.branchId, b.id) : and(eq(staff.branchId, b.id), eq(staff.status, "active")))
        .orderBy(asc(staff.fullNameEn));
      return { b, people };
    });
    if (!data) return notFound();
    const c = (k: string) => t(`staff.exportColumns.${k}` as "staff.exportColumns.nameAr");
    if (list === "staff") {
      const rows = data.people.map(({ s, roomAr, roomEn }) => [
        s.fullNameAr,
        s.fullNameEn,
        s.jobTitle,
        (locale === "ar" ? roomAr : roomEn) ?? "",
        s.deviceEmployeeNo ?? "",
        s.shiftStart,
        s.isQualifiedCarer ? t("staff.exportColumns.yes") : t("staff.exportColumns.no"),
        s.startDate ?? "",
        s.endDate ?? "",
        s.status === "left" ? t("staff.left") : t("staff.current"),
      ]);
      const body = await buildWorkbook(
        t("staff.title"),
        ["nameAr", "nameEn", "jobTitle", "usualRoom", "deviceNo", "shiftStart", "carer", "startDate", "endDate", "status"].map((k) => ({ header: c(k) })),
        rows,
        locale,
      );
      return xlsxResponse(body, `staff-${data.b.code}-${stamp}.xlsx`);
    }
    const rows = data.people.map(({ s, d }) => [
      day.data,
      s.fullNameAr,
      s.fullNameEn,
      s.deviceEmployeeNo ?? "",
      d?.firstIn ? cairoTimeOf(d.firstIn) : "",
      d?.lastOut ? cairoTimeOf(d.lastOut) : "",
      d ? t(`staffAttendance.status.${d.status as "present"}`) : t("staffAttendance.status.none"),
    ]);
    const body = await buildWorkbook(
      t("staffAttendance.title"),
      ["date", "nameAr", "nameEn", "deviceNo", "firstIn", "lastOut", "status"].map((k) => ({ header: c(k) })),
      rows,
      locale,
    );
    return xlsxResponse(body, `staff-attendance-${data.b.code}-${day.data}.xlsx`);
  }

  // Children and waitlist: everyone who can open those screens; row-level security limits the rows.
  if (list === "children" || list === "waitlist") {
    const branchId = z.uuid().safeParse(url.searchParams.get("branch"));
    if (!branchId.success || !(list === "children" ? canViewChildren(user) : canViewWaitlist(user))) return notFound();
    const data = await withUserDb(user.id, async (tx) => {
      const [b] = await tx.select().from(branch).where(eq(branch.id, branchId.data));
      if (!b) return null;
      if (list === "children") return { b, children: await childList(tx, b.id, { show: url.searchParams.get("show") === "left" ? "left" : "current" }), waiting: [] };
      const waiting = await tx
        .select({ w: waitlistEntry, band: ageBand })
        .from(waitlistEntry)
        .leftJoin(ageBand, eq(ageBand.id, waitlistEntry.ageBandId))
        .where(and(eq(waitlistEntry.branchId, b.id), eq(waitlistEntry.status, "waiting")))
        .orderBy(asc(waitlistEntry.requestedStartMonth));
      return { b, children: [], waiting };
    });
    if (!data) return notFound();
    const age = (dob: string) => {
      const m = ageInMonths(dob, stamp);
      return t("children.age", { years: Math.floor(m / 12), months: m % 12 });
    };
    if (list === "children") {
      const rows = data.children.map((c) => [
        c.studentNo,
        c.fullNameAr,
        c.fullNameEn,
        c.dateOfBirth,
        age(c.dateOfBirth),
        t(`children.gender.${c.gender as "female"}`),
        (locale === "ar" ? c.roomNameAr : c.roomNameEn) ?? "",
        c.startDate ?? "",
        t(`children.status.${c.status as "active"}`),
        c.hasRecordsConsent ? t("settings.common.yes") : t("settings.common.no"),
        c.isDemo ? t("app.demoData") : "",
      ]);
      const cols = ["number", "nameAr", "nameEn", "dob", "ageLabel", "genderLabel", "room", "startLabel", "statusLabel", "consentLabel", "demoLabel"].map((k) => ({
        header: t(`children.exportColumns.${k as "number"}`),
        width: k.startsWith("name") ? 28 : 16,
      }));
      return xlsxResponse(await buildWorkbook(`${t("children.title")} ${data.b.code}`, cols, rows, locale), `children-${data.b.code}-${stamp}.xlsx`);
    }
    const rows = data.waiting.map(({ w, band }) => [
      w.studentName,
      w.dateOfBirth,
      age(w.dateOfBirth),
      band ? localName(band, locale) : "",
      w.requestedStartMonth.slice(0, 7),
      w.guardianName ?? "",
      w.guardianPhone,
      w.notes ?? "",
    ]);
    const cols = ["childName", "dob", "ageLabel", "band", "month", "guardianName", "phone", "notes"].map((k) => ({ header: t(`children.exportColumns.${k as "number"}`), width: 22 }));
    return xlsxResponse(await buildWorkbook(t("children.waitlistPage.title"), cols, rows, locale), `waitlist-${data.b.code}-${stamp}.xlsx`);
  }

  if (!isOrgAdmin(user)) return notFound();

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
    return xlsxResponse(await buildWorkbook(localName(data.b, locale), cols, rows, locale), `classes-${data.b.code}-${stamp}.xlsx`);
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
