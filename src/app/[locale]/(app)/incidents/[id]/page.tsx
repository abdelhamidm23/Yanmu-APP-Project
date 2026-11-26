import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { branchRooms } from "@/db/children";
import { branchPeople, childrenForIncident, incidentDetail } from "@/db/safety";
import { requireSafety } from "@/lib/require-user";
import { canManageSafety, hasRoleIn } from "@/lib/permissions";
import { formatPlainDate, formatTimestamp } from "@/lib/format";
import { todayInCairo } from "@/lib/calendar";
import { localName } from "@/lib/i18n-names";
import { INCIDENT_CATEGORY_KEYS, INCIDENT_SEVERITY_KEYS } from "@/lib/incidents";
import { Card } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { Flag } from "@/components/children/BranchTabs";
import { IncidentStatusFlag, SafetyResult, SeverityFlag } from "@/components/safety/Safety";
import { ackAlert } from "../../inbox/alert-actions";
import {
  actionDone,
  addAction,
  addFile,
  addPerson,
  closeIncident,
  editIncident,
  markSeen,
  removePerson,
  reviewIncident,
  saveGuardian,
  saveReport,
  submitReport,
} from "../actions";

const textarea = "min-h-11 w-full rounded-button border border-outline bg-surface p-3 text-[15px] text-ink";

/** One incident (spec §8.7): the first report, people, guardian told, full report, actions, review and closure. */
export default async function IncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ok?: string; done?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const user = await requireSafety(locale, "open");
  const t = await getTranslations("safety");
  const ta = await getTranslations("alerts");
  const loc = locale === "en" ? "en" : "ar";
  const when = (d: Date | string) => formatTimestamp(new Date(d), loc, user.digits);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await withUserDb(user.id, async (tx) => {
    const d = await incidentDetail(tx, id);
    if (!d) return null;
    const b = d.incident.branchId;
    const manager = canManageSafety(user, b);
    const [rooms, assignees, children, staffRows] = await Promise.all([
      manager ? branchRooms(tx, b) : Promise.resolve([]),
      manager ? branchPeople(tx, b) : Promise.resolve([]),
      childrenForIncident(tx, b, null),
      manager
        ? (tx.execute(sql`select id, full_name_ar as "nameAr", full_name_en as "nameEn" from staff where branch_id = ${b} and status = 'active' order by full_name_en`) as unknown as Promise<
            { id: string; nameAr: string; nameEn: string }[]
          >)
        : Promise.resolve([] as { id: string; nameAr: string; nameEn: string }[]),
    ]);
    return { ...d, manager, rooms, assignees, children, staff: staffRows };
  });
  if (!data) notFound();
  const { incident: i, manager } = data;
  const b = i.branchId;
  const open = i.status !== "closed";
  const editable = open && (manager || i.createdBy === user.id);
  const reviewer = hasRoleIn(user, ["company_manager", "owner"], b);
  const owner = hasRoleIn(user, ["owner"], b);
  const viewer = hasRoleIn(user, ["owner", "company_manager", "branch_manager"], b);
  const critical = i.severity === "critical";
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="incidentId" value={i.id} />
    </>
  );
  const today = todayInCairo();

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/incidents?branch=${b}`} className="text-brand underline">{t("detail.back")}</Link>
      <PageHeader title={i.fromPickup ? t("detail.pickupTitle") : `${t(`category.${i.category}` as "category.other")}`}>
        <span className="flex flex-wrap gap-2">
          <SeverityFlag severity={i.severity} />
          <IncidentStatusFlag status={i.status} />
          {i.isDemo ? <Flag tone="neutral">{t("demo")}</Flag> : null}
        </span>
      </PageHeader>
      <SafetyResult searchParams={sp} />

      <Card className={`flex flex-col gap-3 ${critical && open ? "border-critical" : ""}`} data-testid="incident-summary">
        <dl className="grid gap-3 text-[15px] sm:grid-cols-2">
          <div>
            <dt className="text-meta text-muted">{t("detail.occurred")}</dt>
            <dd className="figure">{when(i.occurredAt)}</dd>
          </div>
          <div>
            <dt className="text-meta text-muted">{t("branch")}</dt>
            <dd>
              {loc === "ar" ? i.branchAr : i.branchEn} · {i.roomAr ? (loc === "ar" ? i.roomAr : i.roomEn) : t("detail.noClass")}
            </dd>
          </div>
          <div>
            <dt className="text-meta text-muted">{t("detail.reportedBy")}</dt>
            <dd>{i.reporter ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-meta text-muted">{t("detail.whatHappened")}</dt>
            <dd className="whitespace-pre-wrap">{i.description}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-meta text-muted">{t("detail.immediateAction")}</dt>
            <dd className="whitespace-pre-wrap">{i.fromPickup && !i.immediateAction ? t("detail.pickupAction") : i.immediateAction || "—"}</dd>
          </div>
        </dl>
        {editable ? (
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center font-medium text-brand">{t("detail.edit")}</summary>
            <form action={editIncident} className="mt-3 grid gap-3 sm:grid-cols-2">
              {hidden}
              {manager ? (
                <SelectField
                  id="e-room"
                  name="roomId"
                  label={t("form.class")}
                  defaultValue={i.roomId ?? ""}
                  options={[{ value: "", label: t("form.noClass") }, ...data.rooms.map((r) => ({ value: r.id, label: localName(r, locale) }))]}
                />
              ) : (
                <input type="hidden" name="roomId" value={i.roomId ?? ""} />
              )}
              <SelectField id="e-cat" name="category" label={t("form.category")} defaultValue={i.category} options={INCIDENT_CATEGORY_KEYS.map((c) => ({ value: c, label: t(`category.${c}`) }))} />
              <SelectField
                id="e-sev"
                name="severity"
                label={t("form.severity")}
                defaultValue={i.severity}
                options={INCIDENT_SEVERITY_KEYS.filter((s) => !critical || s === "critical").map((s) => ({ value: s, label: t(`severity.${s}`) }))}
              />
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label htmlFor="e-desc" className="text-[13px] font-medium text-subtle">{t("form.description")}</label>
                <textarea id="e-desc" name="description" defaultValue={i.description} required minLength={3} rows={3} className={textarea} />
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label htmlFor="e-act" className="text-[13px] font-medium text-subtle">{t("form.action")}</label>
                <textarea id="e-act" name="immediateAction" defaultValue={i.immediateAction} rows={2} className={textarea} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" variant="secondary">{t("detail.saveEdit")}</Button>
              </div>
            </form>
          </details>
        ) : null}
      </Card>

      {data.alerts.length ? (
        <Card className="flex flex-col gap-2" data-testid="incident-alerts">
          <h2 className="text-section-title font-semibold">{t("detail.alerts")}</h2>
          {data.alerts.map((a) => (
            <div key={a.id} className="flex flex-col gap-1 text-[14px]">
              <span className="figure">{t("detail.alertLine", { count: a.people, n: String(a.people), when: when(a.raisedAt) })}</span>
              {a.acknowledgedAt ? (
                <span className="text-verified-fg" data-testid="alert-acknowledged">{t("detail.ackBy", { name: a.acknowledgedBy ?? "—", when: when(a.acknowledgedAt) })}</span>
              ) : a.tier === "critical" && open ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-critical">{t("detail.notAcked")}</span>
                  <form action={ackAlert}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="alertId" value={a.id} />
                    <input type="hidden" name="back" value={`/incidents/${i.id}`} />
                    <Button type="submit" variant="danger" data-testid="ack-alert">{ta("ack")}</Button>
                  </form>
                </div>
              ) : null}
            </div>
          ))}
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3" data-testid="incident-people">
        <h2 className="text-section-title font-semibold">{t("detail.people")}</h2>
        {data.people.length === 0 ? <p className="text-muted">{t("detail.noPeople")}</p> : null}
        <ul className="flex flex-col divide-y divide-divider">
          {data.people.map((p) => (
            <li key={p.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">
                  {p.studentId ? (loc === "ar" ? p.childAr : p.childEn) ?? "—" : p.staffId ? (loc === "ar" ? p.staffAr : p.staffEn) : p.personName}
                </span>{" "}
                <span className="text-meta text-muted">· {t(`detail.roles.${p.role}` as "detail.roles.involved")}</span>
              </span>
              {editable ? (
                <form action={removePerson}>
                  {hidden}
                  <input type="hidden" name="personId" value={p.id} />
                  <button type="submit" className="min-h-11 px-2 text-[14px] text-brand underline">{t("detail.remove")}</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          <form action={addPerson} className="grid gap-3 border-t border-divider pt-3 sm:grid-cols-[2fr_1fr]">
            {hidden}
            <SelectField
              id="p-who"
              name="who"
              label={t("detail.pick")}
              options={[
                ...data.children.map((c) => ({ value: `child:${c.id}`, label: `${t("detail.child")}: ${loc === "ar" ? c.fullNameAr : c.fullNameEn}` })),
                ...data.staff.map((s) => ({ value: `staff:${s.id}`, label: `${t("detail.staffMember")}: ${loc === "ar" ? s.nameAr : s.nameEn}` })),
                { value: "other:", label: t("detail.otherPerson") },
              ]}
            />
            <SelectField id="p-role" name="role" label={t("detail.role")} options={(["injured", "involved", "witness"] as const).map((r) => ({ value: r, label: t(`detail.roles.${r}`) }))} />
            <Field id="p-name" name="personName" label={t("detail.otherPerson")} maxLength={200} />
            <div className="self-end">
              <Button type="submit" variant="secondary" data-testid="add-person">{t("detail.addPerson")}</Button>
            </div>
          </form>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3" data-testid="incident-guardian">
        <h2 className="text-section-title font-semibold">{t("detail.guardian")}</h2>
        {i.guardianNotifiedAt ? (
          <p className="text-[15px]">
            {t("detail.guardianTold", { when: when(i.guardianNotifiedAt), name: i.guardianNotifiedBy ?? "—" })}
            {i.guardianNotificationNote ? <span className="mt-1 block whitespace-pre-wrap text-muted">{i.guardianNotificationNote}</span> : null}
          </p>
        ) : (
          <p className="text-attention">{t("detail.guardianNotYet")}</p>
        )}
        {editable ? (
          <form action={saveGuardian} className="grid gap-3 sm:grid-cols-2">
            {hidden}
            <Field id="g-when" name="when" type="datetime-local" label={t("detail.guardianWhen")} required />
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="g-note" className="text-[13px] font-medium text-subtle">{t("detail.guardianNote")}</label>
              <textarea id="g-note" name="note" required minLength={2} maxLength={2000} rows={2} defaultValue={i.guardianNotificationNote ?? ""} className={textarea} />
            </div>
            <div>
              <Button type="submit" variant="secondary" data-testid="save-guardian">{t("detail.saveGuardian")}</Button>
            </div>
          </form>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3" data-testid="incident-report">
        <h2 className="text-section-title font-semibold">{t("detail.report")}</h2>
        <p className="text-meta text-muted">{t("detail.reportHelp")}</p>
        {editable ? (
          <form action={saveReport} className="flex flex-col gap-2">
            {hidden}
            <label htmlFor="r-details" className="sr-only">{t("detail.reportDetails")}</label>
            <textarea id="r-details" name="reportDetails" rows={6} maxLength={8000} defaultValue={i.reportDetails ?? ""} className={textarea} data-testid="report-details" />
            <div>
              <Button type="submit" variant="secondary" data-testid="save-report">{t("detail.saveReport")}</Button>
            </div>
          </form>
        ) : (
          <p className="whitespace-pre-wrap">{i.reportDetails ?? "—"}</p>
        )}
        <h3 className="text-row-title font-semibold">{t("detail.files")}</h3>
        {data.files.length === 0 ? <p className="text-muted">{t("detail.noFiles")}</p> : null}
        <ul className="flex flex-wrap gap-3">
          {data.files.map((f) => (
            <li key={f.id}>
              {f.mimeType.startsWith("image/") ? (
                <a href={`/api/attachment/${f.attachmentId}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/attachment/${f.attachmentId}`} alt={f.fileName} className="size-24 rounded-button border border-border object-cover" />
                </a>
              ) : (
                <a href={`/api/attachment/${f.attachmentId}`} target="_blank" rel="noreferrer" className="text-brand underline">{f.fileName}</a>
              )}
            </li>
          ))}
        </ul>
        {editable ? (
          <form action={addFile} className="flex flex-wrap items-end gap-3">
            {hidden}
            <div className="flex flex-col gap-1">
              <label htmlFor="f-file" className="text-[13px] font-medium text-subtle">{t("detail.addFile")}</label>
              <input id="f-file" name="file" type="file" accept="image/*,application/pdf" capture="environment" required className="min-h-11 text-[14px]" />
            </div>
            <Button type="submit" variant="secondary">{t("detail.upload")}</Button>
          </form>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3" data-testid="incident-actions">
        <h2 className="text-section-title font-semibold">{t("detail.actions")}</h2>
        {data.actions.length === 0 ? <p className="text-muted">{t("detail.noActions")}</p> : null}
        <ul className="flex flex-col divide-y divide-divider">
          {data.actions.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-col">
                <span className="font-medium">{x.description}</span>
                <span className="figure text-meta text-muted">
                  {x.owner ?? "—"} · {t("detail.due", { date: formatPlainDate(x.dueOn, loc, user.digits) })}
                  {x.doneAt ? ` · ${t("detail.doneBy", { name: x.doneBy ?? "—" })}` : ""}
                </span>
              </span>
              {x.doneAt ? (
                <Flag tone="good">✓</Flag>
              ) : (
                <span className="flex items-center gap-2">
                  {x.dueOn < today ? <Flag tone="critical">{t("detail.overdue")}</Flag> : null}
                  {x.ownerId === user.id || manager ? (
                    <form action={actionDone}>
                      {hidden}
                      <input type="hidden" name="actionId" value={x.id} />
                      <Button type="submit" variant="secondary" data-testid="action-done">{t("detail.markDone")}</Button>
                    </form>
                  ) : null}
                </span>
              )}
            </li>
          ))}
        </ul>
        {manager && open ? (
          <form action={addAction} className="grid gap-3 border-t border-divider pt-3 sm:grid-cols-2">
            {hidden}
            <div className="sm:col-span-2">
              <Field id="a-desc" name="description" label={t("detail.actionDesc")} required minLength={3} maxLength={1000} />
            </div>
            <SelectField id="a-owner" name="ownerUserId" label={t("detail.actionOwner")} options={data.assignees.map((p) => ({ value: p.id, label: p.name }))} />
            <Field id="a-due" name="dueOn" type="date" label={t("detail.actionDue")} min={today} required />
            <div>
              <Button type="submit" variant="secondary" data-testid="add-action">{t("detail.addAction")}</Button>
            </div>
          </form>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3" data-testid="incident-progress">
        <h2 className="text-section-title font-semibold">{t("detail.progress")}</h2>
        <ol className="flex flex-col gap-2 text-[15px]">
          <li>
            {i.seenAt ? (
              <span className="text-verified-fg">✓ {t("detail.seen", { name: i.seenBy ?? "—", when: when(i.seenAt) })}</span>
            ) : viewer && open ? (
              <form action={markSeen}>
                {hidden}
                <Button type="submit" variant="secondary" data-testid="mark-seen">{t("detail.markSeen")}</Button>
              </form>
            ) : (
              <span className="text-muted">{t("incidents.notSeen")}</span>
            )}
          </li>
          <li>
            {i.reportSubmittedAt ? (
              <span className="text-verified-fg">✓ {t("detail.submitted", { name: i.reportSubmittedBy ?? "—", when: when(i.reportSubmittedAt) })}</span>
            ) : editable ? (
              <form action={submitReport} className="flex flex-col gap-1">
                {hidden}
                <Button type="submit" className="self-start" data-testid="submit-report">{t("detail.submit")}</Button>
                <span className="text-meta text-muted">{t("detail.submitHelp")}</span>
              </form>
            ) : null}
          </li>
          {i.reportSubmittedAt ? (
            <li>
              {i.reviewedAt ? (
                <span className="text-verified-fg">
                  ✓ {t("detail.reviewed", { name: i.reviewedBy ?? "—", when: when(i.reviewedAt) })}
                  {i.reviewNote ? <span className="block whitespace-pre-wrap text-muted">{i.reviewNote}</span> : null}
                </span>
              ) : reviewer ? (
                <form action={reviewIncident} className="flex flex-col gap-2">
                  {hidden}
                  <label htmlFor="rv-note" className="text-[13px] font-medium text-subtle">{t("detail.reviewNote")}</label>
                  <textarea id="rv-note" name="note" rows={2} maxLength={2000} className={textarea} />
                  <Button type="submit" className="self-start" data-testid="mark-reviewed">{t("detail.markReviewed")}</Button>
                </form>
              ) : (
                <span className="text-attention">{t("detail.waitingReview")}</span>
              )}
            </li>
          ) : null}
          {i.reviewedAt ? (
            <li>
              {i.closedAt ? (
                <span className="text-verified-fg" data-testid="incident-closed">
                  ✓ {t("detail.closed", { name: i.closedBy ?? "—", when: when(i.closedAt) })}
                  {i.closeNote ? <span className="block whitespace-pre-wrap text-muted">{i.closeNote}</span> : null}
                </span>
              ) : (critical ? owner : reviewer) ? (
                <form action={closeIncident} className="flex flex-col gap-2">
                  {hidden}
                  <label htmlFor="c-note" className="text-[13px] font-medium text-subtle">{t("detail.closeNote")}</label>
                  <textarea id="c-note" name="note" rows={2} maxLength={2000} className={textarea} />
                  {critical ? <span className="text-meta text-muted">{t("detail.signOffHelp")}</span> : null}
                  <Button type="submit" variant="success" className="self-start" data-testid="close-incident">{critical ? t("detail.signOff") : t("detail.close")}</Button>
                </form>
              ) : (
                <span className="text-attention">{critical ? t("detail.waitingOwner") : t("detail.waitingReview")}</span>
              )}
            </li>
          ) : null}
        </ol>
      </Card>
      {!open ? (
        <Link href={`/incidents?branch=${b}&view=closed`} className={`${buttonClasses("secondary")} self-start`}>{t("detail.back")}</Link>
      ) : null}
    </div>
  );
}
