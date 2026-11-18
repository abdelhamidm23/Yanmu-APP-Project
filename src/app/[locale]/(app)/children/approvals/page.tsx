import { and, desc, eq, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { branchDirectory, branchRooms, visibleBranches } from "@/db/children";
import { appUser, approvalRequest, student } from "@/db/schema";
import { requireChildren } from "@/lib/require-user";
import { hasRoleIn, isOwner } from "@/lib/permissions";
import { ageInMonths } from "@/lib/children";
import { todayInCairo } from "@/lib/calendar";
import { formatNumber, formatTimestamp } from "@/lib/format";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { ChildResult } from "@/components/children/ChildResult";
import { cancelRequest, decideOverCapacity, decideTransfer } from "./actions";

export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireChildren(locale, "approvals");
  const t = await getTranslations("children");
  const loc = locale === "en" ? "en" : "ar";
  const n = (v: number) => formatNumber(v, loc, user.digits);
  const today = todayInCairo();

  const data = await withUserDb(user.id, async (tx) => {
    const requests = await tx
      .select({ r: approvalRequest, s: student, askedBy: appUser.name })
      .from(approvalRequest)
      .leftJoin(student, eq(student.id, approvalRequest.studentId))
      .leftJoin(appUser, eq(appUser.id, approvalRequest.createdBy))
      .where(and(eq(approvalRequest.status, "pending"), inArray(approvalRequest.type, ["over_capacity", "transfer"])))
      .orderBy(desc(approvalRequest.createdAt));
    const directory = await branchDirectory(tx);
    const visible = await visibleBranches(tx);
    const roomsByBranch = new Map<string, Awaited<ReturnType<typeof branchRooms>>>();
    for (const b of visible) roomsByBranch.set(b.id, await branchRooms(tx, b.id));
    return { requests, directory, roomsByBranch };
  });
  const { requests, directory, roomsByBranch } = data;
  const branchName = (id: string | null) => {
    const b = directory.find((x) => x.id === id);
    return b ? localName(b, locale) : "—";
  };
  const back = sp.branch ? `/children?branch=${sp.branch}` : "/children";

  return (
    <div className="flex flex-col gap-4">
      <Link href={back} className="text-[14px] text-brand underline">{t("backToList")}</Link>
      <PageHeader title={t("approvalsPage.title")} help={t("approvalsPage.help")} />
      <ChildResult searchParams={sp} />
      {requests.length === 0 ? <Card><p className="text-muted">{t("approvalsPage.empty")}</p></Card> : null}
      <ul className="flex flex-col gap-3" data-testid="approval-list">
        {requests.map(({ r, s, askedBy }) => {
          const childName = s ? (locale === "ar" ? s.fullNameAr : s.fullNameEn) : "—";
          const months = s ? ageInMonths(s.dateOfBirth, today) : null;
          const mine = r.createdBy === user.id;
          const ownerDecides = r.type === "over_capacity" && isOwner(user) && !mine;
          const receiving = r.type === "transfer" && r.toBranchId && hasRoleIn(user, ["branch_manager"], r.toBranchId) && !mine;
          const rooms = r.toBranchId ? (roomsByBranch.get(r.toBranchId) ?? []) : [];
          return (
            <li key={r.id}>
              <Card className="flex flex-col gap-3" data-testid={`request-${r.type}`}>
                <div className="flex flex-col gap-1">
                  <span className="text-meta font-semibold text-attention">
                    {r.type === "transfer" ? t("approvalsPage.transfer", { from: branchName(r.branchId), to: branchName(r.toBranchId) }) : t("approvalsPage.overCapacity", { branch: branchName(r.branchId) })}
                  </span>
                  {s ? (
                    <Link href={`/children/${s.id}`} className="text-row-title font-semibold text-ink underline">{childName}</Link>
                  ) : null}
                  {months !== null ? <span className="figure text-meta text-subtle">{t("age", { years: n(Math.floor(months / 12)), months: n(months % 12) })}</span> : null}
                  {r.reason ? <p className="text-[14px]">“{r.reason}”</p> : null}
                  <span className="figure text-meta text-muted">{t("approvalsPage.askedBy", { name: askedBy ?? "—", date: formatTimestamp(r.createdAt, loc, user.digits) })}</span>
                </div>

                {ownerDecides ? (
                  <form action={decideOverCapacity} className="flex flex-col gap-3">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={r.id} />
                    <Field id={`note-${r.id}`} name="note" label={t("approvalsPage.note")} />
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" name="decision" value="approve" variant="success" data-testid="approve">{t("approvalsPage.approve")}</Button>
                      <Button type="submit" name="decision" value="decline" variant="secondary">{t("approvalsPage.decline")}</Button>
                    </div>
                  </form>
                ) : receiving ? (
                  <form action={decideTransfer} className="grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={r.id} />
                    <SelectField id={`room-${r.id}`} name="roomId" label={t("room")} options={rooms.map((x) => ({ value: x.id, label: `${localName(x, locale)} · ${locale === "ar" ? x.bandNameAr : x.bandNameEn}` }))} />
                    <Field id={`start-${r.id}`} name="startDate" type="date" label={t("form.startDate")} defaultValue={today} />
                    <Field id={`band-${r.id}`} name="bandReason" label={t("detail.bandReasonLabel")} hint={t("detail.bandReasonHint")} />
                    <Field id={`note-${r.id}`} name="note" label={t("approvalsPage.note")} />
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <Button type="submit" name="decision" value="accept" variant="success" data-testid="accept-transfer">{t("approvalsPage.accept")}</Button>
                      <Button type="submit" name="decision" value="decline" variant="secondary">{t("approvalsPage.decline")}</Button>
                    </div>
                  </form>
                ) : mine ? (
                  <form action={cancelRequest} className="flex flex-col gap-2">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={r.id} />
                    <p className="text-meta text-muted">{t(r.type === "transfer" ? "approvalsPage.waitingBranch" : "approvalsPage.waitingOwner")}</p>
                    <Button type="submit" variant="secondary" className="self-start">{t("approvalsPage.cancelRequest")}</Button>
                  </form>
                ) : (
                  <p className="text-meta text-muted">{t(r.type === "transfer" ? "approvalsPage.waitingBranch" : "approvalsPage.waitingOwner")}</p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
