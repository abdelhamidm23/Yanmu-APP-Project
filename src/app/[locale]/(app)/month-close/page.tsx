import { getTranslations } from "next-intl/server";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { period, periodBatches, periodLines } from "@/db/closing";
import { templateLines } from "@/db/month-pack";
import { requireClosing } from "@/lib/require-user";
import { MONTH_VIEW_ROLES, canCloseMonth, canReopenMonth, hasRoleIn } from "@/lib/permissions";
import { todayInCairo } from "@/lib/calendar";
import { formatTimestamp } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";
import { Amount, monthLabel } from "@/components/money/Money";
import { ClosingResult } from "@/components/closing/Closing";
import { DataStatusChip } from "@/components/closing/DataStatusChip";
import { UploadForm } from "./UploadForm";
import { closeMonth, decideReopen, requestReopen, rollbackMonthClose } from "./actions";

function addMonths(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Month close (spec §8.10): Excel pack, template upload with differences explained, close, reopen with the owner. */
export default async function MonthClosePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; month?: string; ok?: string; done?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireClosing(locale, "month");
  const t = await getTranslations("closing.month");
  const tc = await getTranslations("closing");
  const loc = locale === "en" ? "en" : "ar";
  const thisMonth = todayInCairo().slice(0, 7);
  const months = Array.from({ length: 13 }, (_, i) => addMonths(thisMonth, -i));
  const month = sp.month && months.includes(sp.month) ? sp.month : addMonths(thisMonth, -1);
  const first = `${month}-01`;

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, MONTH_VIEW_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const p = await period(tx, b.id, first);
    const lines = await periodLines(tx, p.id);
    const batches = await periodBatches(tx, b.id, first);
    const labels = new Map((await templateLines(tx, b.id, first, loc, await getTranslations({ locale: loc }))).map((l) => [l.code, l.label]));
    return { branches, b, p, lines, batches, labels };
  });
  if (!data) return <Card>{tc("noBranch")}</Card>;
  const { branches, b, p, lines, batches, labels } = data;
  const closer = canCloseMonth(user, b.id);
  const owner = canReopenMonth(user, b.id);
  const isOpen = p.status === "open";
  const over = month < thisMonth;
  const q = `branch=${b.id}&month=${month}&locale=${locale}`;
  const amount = (v: string | bigint) => <Amount locale={locale} digits={user.digits} value={BigInt(v)} />;
  const label = (code: string) => labels.get(code) ?? code;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="branchId" value={b.id} />
      <input type="hidden" name="month" value={month} />
    </>
  );
  const nextMonthLabel = monthLabel(`${addMonths(month, 1)}-01`, locale, user.digits);
  const differences = lines.filter((l) => l.kind === "check" && l.appPiastres !== l.amountPiastres).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")} />
      <BranchTabs branches={branches} current={b.id} path="/month-close" locale={locale} label={tc("branch")} />
      <ClosingResult searchParams={sp} />

      <form method="get" action={`/${locale}/month-close`} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="branch" value={b.id} />
        <div className="flex flex-col gap-1">
          <label htmlFor="mc-month" className="text-[13px] font-medium text-subtle">{t("month")}</label>
          <select id="mc-month" name="month" defaultValue={month} className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]">
            {months.map((m) => (
              <option key={m} value={m}>{monthLabel(`${m}-01`, locale, user.digits)}</option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">{t("show")}</Button>
      </form>

      <Card data-testid="month-status">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-section-title font-semibold">{monthLabel(first, locale, user.digits)}</h2>
          <DataStatusChip status={isOpen ? "provisional" : "verified"} />
        </div>
        <p className="mt-1 text-[14px] text-subtle">
          {!isOpen
            ? t("closedBy", { name: p.closedBy ?? "—", when: p.closedAt ? formatTimestamp(new Date(p.closedAt), loc, user.digits) : "" })
            : over
              ? t("openDue", { month: nextMonthLabel })
              : t("notOver")}
        </p>
        {p.reopenedAt ? (
          <p className="mt-1 text-meta text-muted">{t("reopenedBy", { name: p.reopenedBy ?? "—", when: formatTimestamp(new Date(p.reopenedAt), loc, user.digits) })}</p>
        ) : null}
        {!isOpen ? <p className="mt-2 text-[14px]">{t("lockedNote")}</p> : null}
      </Card>

      {!isOpen && p.reopenRequestedAt ? (
        <Card data-testid="reopen-request">
          <h2 className="font-semibold">{t("reopen.asked", { name: p.reopenRequestedBy ?? "—" })}</h2>
          <p className="mt-1 text-[14px]">{p.reopenReason}</p>
          {owner && p.reopenRequestedById !== user.id ? (
            <form action={decideReopen} className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="periodId" value={p.id} />
              <input type="hidden" name="back" value={`/month-close?branch=${b.id}&month=${month}`} />
              <Button type="submit" name="decision" value="reopen" data-testid="reopen-yes">{t("reopen.approve")}</Button>
              <Button type="submit" name="decision" value="keep" variant="secondary">{t("reopen.keep")}</Button>
            </form>
          ) : (
            <p className="mt-2 text-meta text-muted">{t("reopen.waiting")}</p>
          )}
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">{t("steps.pack")}</h2>
        <p className="text-[14px] text-subtle">{t("steps.packHelp")}</p>
        <a href={`/api/month-close/pack?${q}`} className={`${buttonClasses("secondary")} self-start`} data-testid="download-pack">{t("downloadPack")}</a>
      </Card>

      {closer && isOpen ? (
        <>
          <Card className="flex flex-col gap-3">
            <h2 className="font-semibold">{t("steps.template")}</h2>
            <p className="text-[14px] text-subtle">{t("steps.templateHelp")}</p>
            <a href={`/api/month-close/template?${q}`} className={`${buttonClasses("secondary")} self-start`} data-testid="download-template">{t("downloadTemplate")}</a>
          </Card>
          <Card className="flex flex-col gap-3">
            <h2 className="font-semibold">{t("steps.upload")}</h2>
            <UploadForm branchId={b.id} month={month} />
          </Card>
        </>
      ) : null}

      <h2 className="text-section-title font-semibold">{t("lines.title")}</h2>
      {lines.length === 0 ? (
        <Card data-testid="no-lines">{t("lines.none")}</Card>
      ) : (
        <Card data-testid="month-lines">
          {differences ? <p className="mb-2 text-[14px] text-attention">{t("lines.differences", { count: differences })}</p> : null}
          <ul className="divide-y divide-divider">
            {lines.map((l) => {
              const differs = l.kind === "check" && l.appPiastres !== l.amountPiastres;
              return (
                <li key={l.id} className="flex flex-col gap-1 py-2 text-[14px]">
                  <span className="flex flex-wrap justify-between gap-2">
                    <span>{label(l.lineKey)}</span>
                    <span className={differs ? "font-semibold text-attention" : ""}>{amount(l.amountPiastres)}</span>
                  </span>
                  {differs && l.appPiastres !== null ? (
                    <span className="text-meta text-muted">
                      {t("lines.app")} {amount(l.appPiastres)} · {t("lines.difference")} {amount(BigInt(l.amountPiastres) - BigInt(l.appPiastres))}
                    </span>
                  ) : null}
                  {l.note ? <span className="text-meta text-muted">{l.note}</span> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {batches.length ? (
        <Card>
          <h2 className="font-semibold">{t("uploads")}</h2>
          <ul className="mt-2 divide-y divide-divider" data-testid="month-batches">
            {batches.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
                <span>
                  {x.fileName.slice(8)} · {x.by ?? "—"} · {formatTimestamp(new Date(x.createdAt), loc, user.digits)}
                </span>
                {x.status === "committed" ? (
                  closer && isOpen ? (
                    <form action={rollbackMonthClose}>
                      {hidden}
                      <input type="hidden" name="batchId" value={x.id} />
                      <Button type="submit" variant="secondary" data-testid="month-rollback">{t("rollback")}</Button>
                    </form>
                  ) : (
                    <Flag tone="good">{t("inUse")}</Flag>
                  )
                ) : (
                  <Flag tone="neutral">{t("replaced")}</Flag>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {closer && isOpen ? (
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">{t("steps.close")}</h2>
          <p className="text-[14px] text-subtle">{t("steps.closeHelp")}</p>
          <form action={closeMonth}>
            {hidden}
            <Button type="submit" disabled={!over || lines.length === 0} data-testid="close-month">{t("close")}</Button>
          </form>
        </Card>
      ) : null}

      {closer && !isOpen && !p.reopenRequestedAt ? (
        <Card>
          <form action={requestReopen} className="flex flex-col gap-3">
            {hidden}
            <h2 className="font-semibold">{t("reopen.title")}</h2>
            <p className="text-[14px] text-subtle">{t("reopen.help")}</p>
            <label htmlFor="mc-reason" className="text-[13px] font-medium text-subtle">{t("reopen.reason")}</label>
            <textarea id="mc-reason" name="reason" rows={3} required minLength={5} maxLength={1000} className="w-full rounded-button border border-outline bg-surface p-3 text-[15px]" />
            <Button type="submit" variant="secondary" className="self-start" data-testid="ask-reopen">{t("reopen.ask")}</Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
