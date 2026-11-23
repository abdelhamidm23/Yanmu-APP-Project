import "server-only";
import { z } from "zod";
import type { getTranslations } from "next-intl/server";
import { withUserDb } from "./rls";
import { INCIDENT_VIEWS, ISSUE_VIEWS, listIncidents, listIssues } from "./safety";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";
import { canViewSafety } from "@/lib/permissions";
import { formatTimestamp } from "@/lib/format";
import type { CurrentUser } from "@/lib/session";

export const SAFETY_LISTS = ["incidents", "issues"] as const;
type T = Awaited<ReturnType<typeof getTranslations>>;

/** Excel exports of incidents and issues (rule 13), for the people who see the whole branch. RLS applies. */
export async function safetyExport(list: string, url: URL, user: CurrentUser, t: T, locale: "ar" | "en", stamp: string): Promise<Response | null> {
  const branchId = z.uuid().safeParse(url.searchParams.get("branch"));
  if (!branchId.success || !canViewSafety(user, branchId.data)) return null;
  const b = branchId.data;
  const c = (k: string) => ({ header: t(`safety.exportColumns.${k}` as "safety.exportColumns.when") });
  const yes = (v: unknown) => (v ? t("settings.common.yes") : t("settings.common.no"));
  const when = (d: Date | string | null) => (d ? formatTimestamp(new Date(d), locale, "latin") : "");

  if (list === "incidents") {
    const view = z.enum(INCIDENT_VIEWS).catch("all").parse(url.searchParams.get("view") ?? "all");
    const rows = await withUserDb(user.id, (tx) => listIncidents(tx, b, view, 5000));
    const body = await buildWorkbook(
      t("safety.incidents.title"),
      ["when", "class", "category", "severity", "status", "description", "children", "reporter", "guardianTold", "reviewed", "openActions", "demo"].map(c),
      rows.map((r) => [
        when(r.occurredAt),
        (locale === "ar" ? r.roomAr : r.roomEn) ?? "",
        t(`safety.category.${r.category}` as "safety.category.other"),
        t(`safety.severity.${r.severity}` as "safety.severity.minor"),
        t(`safety.status.${r.status}` as "safety.status.open"),
        r.description,
        r.children,
        r.reporter ?? "",
        when(r.guardianNotifiedAt),
        when(r.reviewedAt),
        r.openActions,
        yes(r.isDemo),
      ]),
      locale,
    );
    return xlsxResponse(body, `incidents-${stamp}.xlsx`);
  }

  if (list === "issues") {
    const view = z.enum(ISSUE_VIEWS).catch("all").parse(url.searchParams.get("view") ?? "all");
    const rows = await withUserDb(user.id, (tx) => listIssues(tx, b, view, user.id));
    const body = await buildWorkbook(
      t("safety.issues.title"),
      ["title", "category", "priority", "status", "assignee", "due", "created", "resolved", "demo"].map(c),
      rows.map((r) => [
        r.title,
        t(`safety.issues.category.${r.category}` as "safety.issues.category.other"),
        t(`safety.issues.priority.${r.priority}` as "safety.issues.priority.normal"),
        t(`safety.issues.status.${r.status}` as "safety.issues.status.open"),
        r.assignee ?? "",
        r.dueOn ?? "",
        when(r.createdAt),
        when(r.resolvedAt),
        yes(r.isDemo),
      ]),
      locale,
    );
    return xlsxResponse(body, `issues-${stamp}.xlsx`);
  }
  return null;
}
