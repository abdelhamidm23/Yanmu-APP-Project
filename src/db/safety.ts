import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "./rls";
import { cairoDayStart } from "./money";

/** Incidents and issues (spec §8.7, §8.8). Row-level security decides which rows each person sees. */

export const INCIDENT_VIEWS = ["open", "critical", "closed", "all"] as const;
export type IncidentView = (typeof INCIDENT_VIEWS)[number];

export type IncidentRow = {
  id: string;
  branchId: string;
  roomAr: string | null;
  roomEn: string | null;
  occurredAt: Date;
  category: string;
  severity: string;
  status: string;
  description: string;
  reporter: string | null;
  seenAt: Date | null;
  reviewedAt: Date | null;
  reportSubmittedAt: Date | null;
  guardianNotifiedAt: Date | null;
  children: number;
  openActions: number;
  isDemo: boolean;
  fromPickup: boolean;
};

export async function listIncidents(tx: Tx, branchId: string, view: IncidentView, limit = 100): Promise<IncidentRow[]> {
  const where =
    view === "open"
      ? sql`i.status <> 'closed'`
      : view === "critical"
        ? sql`i.severity = 'critical'`
        : view === "closed"
          ? sql`i.status = 'closed'`
          : sql`true`;
  return (await tx.execute(sql`
    select i.id, i.branch_id as "branchId", r.name_ar as "roomAr", r.name_en as "roomEn", i.occurred_at as "occurredAt",
      i.category, i.severity, i.status, i.description, u.full_name as reporter, i.seen_at as "seenAt", i.reviewed_at as "reviewedAt",
      i.report_submitted_at as "reportSubmittedAt", i.guardian_notified_at as "guardianNotifiedAt",
      (select count(*) from incident_person p where p.incident_id = i.id and p.student_id is not null)::int as children,
      (select count(*) from incident_action x where x.incident_id = i.id and x.done_at is null)::int as "openActions",
      i.is_demo as "isDemo", i.pickup_refusal_id is not null as "fromPickup"
    from incident i
    left join room r on r.id = i.room_id
    left join app_user u on u.id = i.created_by
    where i.branch_id = ${branchId} and ${where}
    order by (i.status <> 'closed' and i.severity = 'critical') desc, i.occurred_at desc
    limit ${limit}`)) as unknown as IncidentRow[];
}

export type IncidentDetail = IncidentRow & {
  immediateAction: string;
  reportDetails: string | null;
  guardianNotificationNote: string | null;
  guardianNotifiedBy: string | null;
  seenBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  closedAt: Date | null;
  closedBy: string | null;
  closeNote: string | null;
  createdBy: string | null;
  roomId: string | null;
  branchAr: string;
  branchEn: string;
  reportSubmittedBy: string | null;
};

export async function incidentDetail(tx: Tx, id: string) {
  const [i] = (await tx.execute(sql`
    select i.id, i.branch_id as "branchId", b.name_ar as "branchAr", b.name_en as "branchEn", i.room_id as "roomId",
      r.name_ar as "roomAr", r.name_en as "roomEn", i.occurred_at as "occurredAt", i.category, i.severity, i.status,
      i.description, i.immediate_action as "immediateAction", i.report_details as "reportDetails",
      u.full_name as reporter, i.created_by as "createdBy",
      i.guardian_notified_at as "guardianNotifiedAt", i.guardian_notification_note as "guardianNotificationNote", gu.full_name as "guardianNotifiedBy",
      i.seen_at as "seenAt", su.full_name as "seenBy", i.report_submitted_at as "reportSubmittedAt", rsu.full_name as "reportSubmittedBy",
      i.reviewed_at as "reviewedAt", ru.full_name as "reviewedBy", i.review_note as "reviewNote",
      i.closed_at as "closedAt", cu.full_name as "closedBy", i.close_note as "closeNote",
      0 as children, 0 as "openActions", i.is_demo as "isDemo", i.pickup_refusal_id is not null as "fromPickup"
    from incident i
    join branch b on b.id = i.branch_id
    left join room r on r.id = i.room_id
    left join app_user u on u.id = i.created_by
    left join app_user gu on gu.id = i.guardian_notified_by
    left join app_user su on su.id = i.seen_by
    left join app_user rsu on rsu.id = i.report_submitted_by
    left join app_user ru on ru.id = i.reviewed_by
    left join app_user cu on cu.id = i.closed_by
    where i.id = ${id}`)) as unknown as IncidentDetail[];
  if (!i) return null;
  const people = (await tx.execute(sql`
    select p.id, p.role, p.student_id as "studentId", p.staff_id as "staffId", p.person_name as "personName",
      s.full_name_ar as "childAr", s.full_name_en as "childEn", st.full_name_ar as "staffAr", st.full_name_en as "staffEn"
    from incident_person p
    left join student s on s.id = p.student_id
    left join staff st on st.id = p.staff_id
    where p.incident_id = ${id}
    order by p.created_at`)) as unknown as {
    id: string; role: string; studentId: string | null; staffId: string | null; personName: string | null;
    childAr: string | null; childEn: string | null; staffAr: string | null; staffEn: string | null;
  }[];
  const actions = (await tx.execute(sql`
    select x.id, x.description, x.owner_user_id as "ownerId", u.full_name as owner, to_char(x.due_on, 'YYYY-MM-DD') as "dueOn",
      x.done_at as "doneAt", du.full_name as "doneBy"
    from incident_action x
    left join app_user u on u.id = x.owner_user_id
    left join app_user du on du.id = x.done_by
    where x.incident_id = ${id}
    order by x.done_at nulls first, x.due_on`)) as unknown as {
    id: string; description: string; ownerId: string; owner: string | null; dueOn: string; doneAt: Date | null; doneBy: string | null;
  }[];
  const files = (await tx.execute(sql`
    select f.id, f.attachment_id as "attachmentId", a.file_name as "fileName", a.mime_type as "mimeType"
    from incident_file f join attachment a on a.id = f.attachment_id
    where f.incident_id = ${id} order by f.created_at`)) as unknown as { id: string; attachmentId: string; fileName: string; mimeType: string }[];
  const alerts = (await tx.execute(sql`
    select a.id, a.key, a.tier, a.raised_at as "raisedAt", a.acknowledged_at as "acknowledgedAt", u.full_name as "acknowledgedBy",
      a.send_count as "sendCount", (select count(*) from notification n where n.alert_id = a.id)::int as people
    from alert a left join app_user u on u.id = a.acknowledged_by
    where a.subject_id = ${id} order by a.raised_at`)) as unknown as {
    id: string; key: string; tier: string; raisedAt: Date; acknowledgedAt: Date | null; acknowledgedBy: string | null; sendCount: number; people: number;
  }[];
  return { incident: i, people, actions, files, alerts };
}

/** Children of a class (or the whole branch) to pick from on the short form. RLS limits teachers to their classes. */
export async function childrenForIncident(tx: Tx, branchId: string, roomId: string | null) {
  return (await tx.execute(sql`
    select s.id, s.full_name_ar as "fullNameAr", s.full_name_en as "fullNameEn", e.room_id as "roomId"
    from student s join enrollment e on e.student_id = s.id and e.status = 'active'
    where e.branch_id = ${branchId} and (${roomId}::uuid is null or e.room_id = ${roomId}::uuid)
    order by s.full_name_en
    limit 400`)) as unknown as { id: string; fullNameAr: string; fullNameEn: string; roomId: string }[];
}

export const ISSUE_VIEWS = ["open", "overdue", "mine", "resolved", "all"] as const;
export type IssueView = (typeof ISSUE_VIEWS)[number];

export type IssueRow = {
  id: string; branchId: string; category: string; title: string; details: string | null; priority: string; status: string;
  dueOn: string | null; assignedTo: string | null; assignee: string | null; reporter: string | null; createdBy: string | null;
  createdAt: Date; resolvedAt: Date | null; resolvedBy: string | null; resolutionNote: string | null; photo: string | null;
  overdue: boolean; isDemo: boolean;
};

const ISSUE_COLUMNS = sql`
  i.id, i.branch_id as "branchId", i.category, i.title, i.details, i.priority, i.status, to_char(i.due_on, 'YYYY-MM-DD') as "dueOn",
  i.assigned_to as "assignedTo", au.full_name as assignee, ru.full_name as reporter, i.created_by as "createdBy", i.created_at as "createdAt",
  i.resolved_at as "resolvedAt", xu.full_name as "resolvedBy", i.resolution_note as "resolutionNote", i.photo_attachment_id as photo,
  (i.status <> 'resolved' and i.due_on < (now() at time zone 'Africa/Cairo')::date) as overdue, i.is_demo as "isDemo"`;

export async function listIssues(tx: Tx, branchId: string, view: IssueView, userId: string): Promise<IssueRow[]> {
  const where =
    view === "open"
      ? sql`i.status <> 'resolved'`
      : view === "overdue"
        ? sql`i.status <> 'resolved' and i.due_on < (now() at time zone 'Africa/Cairo')::date`
        : view === "mine"
          ? sql`i.status <> 'resolved' and (i.assigned_to = ${userId} or i.created_by = ${userId})`
          : view === "resolved"
            ? sql`i.status = 'resolved'`
            : sql`true`;
  return (await tx.execute(sql`
    select ${ISSUE_COLUMNS}
    from issue i
    left join app_user au on au.id = i.assigned_to
    left join app_user ru on ru.id = i.created_by
    left join app_user xu on xu.id = i.resolved_by
    where i.branch_id = ${branchId} and ${where}
    order by (i.status = 'resolved'), case i.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
      i.due_on nulls last, i.created_at desc
    limit 200`)) as unknown as IssueRow[];
}

export async function issueDetail(tx: Tx, id: string): Promise<(IssueRow & { branchAr: string; branchEn: string }) | null> {
  const [row] = (await tx.execute(sql`
    select ${ISSUE_COLUMNS}, b.name_ar as "branchAr", b.name_en as "branchEn"
    from issue i
    join branch b on b.id = i.branch_id
    left join app_user au on au.id = i.assigned_to
    left join app_user ru on ru.id = i.created_by
    left join app_user xu on xu.id = i.resolved_by
    where i.id = ${id}`)) as unknown as (IssueRow & { branchAr: string; branchEn: string })[];
  return row ?? null;
}

/** People of a branch for assigning issues and actions (managers only; empty for anyone else). */
export async function branchPeople(tx: Tx, branchId: string) {
  return (await tx.execute(sql`select id, full_name as name, roles from app_branch_people(${branchId})`)) as unknown as {
    id: string; name: string; roles: string;
  }[];
}

/** Incident actions and issues past their due date and not done (spec §9.4 "Overdue actions"). */
export async function overdueActions(tx: Tx, branchId: string | null, onlyUser?: string) {
  const today = sql`(now() at time zone 'Africa/Cairo')::date`;
  return (await tx.execute(sql`
    select 'action' as kind, x.id, x.incident_id as "parentId", x.description as title, to_char(x.due_on, 'YYYY-MM-DD') as "dueOn",
      u.full_name as owner, x.branch_id as "branchId"
    from incident_action x left join app_user u on u.id = x.owner_user_id
    where x.done_at is null and x.due_on < ${today}
      and (${branchId}::uuid is null or x.branch_id = ${branchId}::uuid)
      and (${onlyUser ?? null}::uuid is null or x.owner_user_id = ${onlyUser ?? null}::uuid)
    union all
    select 'issue', i.id, i.id, i.title, to_char(i.due_on, 'YYYY-MM-DD'), u.full_name, i.branch_id
    from issue i left join app_user u on u.id = i.assigned_to
    where i.status <> 'resolved' and i.due_on < ${today}
      and (${branchId}::uuid is null or i.branch_id = ${branchId}::uuid)
      and (${onlyUser ?? null}::uuid is null or i.assigned_to = ${onlyUser ?? null}::uuid)
    order by 5`)) as unknown as { kind: "action" | "issue"; id: string; parentId: string; title: string; dueOn: string; owner: string | null; branchId: string }[];
}

export type SafetySummary = {
  openIncidents: number;
  openCritical: number;
  incidentsToday: number;
  needsSeen: number;
  openIssues: number;
  overdueIssues: number;
  overdueActions: number;
  incidentsThisMonth: number;
};

/** What Today and the figures show about safety for one branch and day. */
export async function safetySummary(tx: Tx, branchId: string, date: string): Promise<SafetySummary> {
  const dayStart = cairoDayStart(date);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const monthStart = cairoDayStart(`${date.slice(0, 7)}-01`);
  const [r] = (await tx.execute(sql`
    select
      (select count(*) from incident where branch_id = ${branchId} and status <> 'closed')::int as "openIncidents",
      (select count(*) from incident where branch_id = ${branchId} and status <> 'closed' and severity = 'critical')::int as "openCritical",
      (select count(*) from incident where branch_id = ${branchId} and occurred_at >= ${dayStart.toISOString()} and occurred_at < ${dayEnd.toISOString()})::int as "incidentsToday",
      (select count(*) from incident where branch_id = ${branchId} and occurred_at >= ${monthStart.toISOString()} and occurred_at < ${dayEnd.toISOString()})::int as "incidentsThisMonth",
      (select count(*) from incident where branch_id = ${branchId} and status = 'open' and seen_at is null)::int as "needsSeen",
      (select count(*) from issue where branch_id = ${branchId} and status <> 'resolved')::int as "openIssues",
      (select count(*) from issue where branch_id = ${branchId} and status <> 'resolved' and due_on < ${date}::date)::int as "overdueIssues",
      (select count(*) from incident_action where branch_id = ${branchId} and done_at is null and due_on < ${date}::date)::int as "overdueActions"
  `)) as unknown as SafetySummary[];
  return r;
}

export type MyAlert = {
  notificationId: string; alertId: string; key: string; tier: string; branchId: string; branchAr: string; branchEn: string;
  subjectTable: string | null; subjectId: string | null; raisedAt: Date; readAt: Date | null; step: number;
  acknowledgedAt: Date | null; acknowledgedBy: string | null; resolvedAt: Date | null; isDemo: boolean;
};

/** This person's alerts, newest first: open ones and the last week's. */
export async function myAlerts(tx: Tx, userId: string, limit = 60): Promise<MyAlert[]> {
  return (await tx.execute(sql`
    select n.id as "notificationId", a.id as "alertId", a.key, a.tier, a.branch_id as "branchId", b.name_ar as "branchAr", b.name_en as "branchEn",
      a.subject_table as "subjectTable", a.subject_id as "subjectId", a.raised_at as "raisedAt", n.read_at as "readAt", n.step,
      a.acknowledged_at as "acknowledgedAt", u.full_name as "acknowledgedBy", a.resolved_at as "resolvedAt", a.is_demo as "isDemo"
    from notification n
    join alert a on a.id = n.alert_id
    join branch b on b.id = a.branch_id
    left join app_user u on u.id = a.acknowledged_by
    where n.user_id = ${userId} and (a.resolved_at is null or a.raised_at > now() - interval '7 days')
    order by (a.tier = 'critical' and a.acknowledged_at is null and a.resolved_at is null) desc, a.raised_at desc
    limit ${limit}`)) as unknown as MyAlert[];
}

/** Critical alerts nobody has acknowledged yet, for this person (the red banner on every screen). */
export async function pendingCritical(tx: Tx, userId: string) {
  return (await tx.execute(sql`
    select a.id, a.key, a.subject_id as "subjectId", a.raised_at as "raisedAt", b.name_ar as "branchAr", b.name_en as "branchEn"
    from notification n join alert a on a.id = n.alert_id join branch b on b.id = a.branch_id
    where n.user_id = ${userId} and a.tier = 'critical' and a.acknowledged_at is null and a.resolved_at is null
      -- The person who reported it already knows; they get the alert in their inbox but no banner.
      and not exists (select 1 from incident i where i.id = a.subject_id and i.created_by = ${userId})
    order by a.raised_at`)) as unknown as { id: string; key: string; subjectId: string | null; raisedAt: Date; branchAr: string; branchEn: string }[];
}

/** Unread alerts for the bell. */
export async function unreadAlertCount(tx: Tx, userId: string): Promise<number> {
  const [r] = (await tx.execute(sql`
    select count(*)::int as n from notification n join alert a on a.id = n.alert_id
    where n.user_id = ${userId} and n.read_at is null and a.resolved_at is null`)) as unknown as { n: number }[];
  return r?.n ?? 0;
}

/** Incidents waiting for this person: reviews for the company manager, sign-offs for the owner. */
export async function incidentsWaitingFor(tx: Tx, user: { grants: { role: string; branchId: string | null }[] }) {
  const owner = user.grants.some((g) => g.role === "owner");
  const cm = user.grants.some((g) => g.role === "company_manager");
  if (!owner && !cm) return [];
  return (await tx.execute(sql`
    select i.id, i.branch_id as "branchId", b.name_ar as "branchAr", b.name_en as "branchEn", i.category, i.severity, i.status,
      i.occurred_at as "occurredAt", i.reviewed_at as "reviewedAt", i.is_demo as "isDemo"
    from incident i join branch b on b.id = i.branch_id
    where i.status = 'under_review'
      and ((i.reviewed_at is null and ${cm || owner}) or (i.reviewed_at is not null and (${owner} or i.severity <> 'critical')))
    order by (i.severity = 'critical') desc, i.report_submitted_at`)) as unknown as {
    id: string; branchId: string; branchAr: string; branchEn: string; category: string; severity: string; status: string;
    occurredAt: Date; reviewedAt: Date | null; isDemo: boolean;
  }[];
}
