import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { requireMoney } from "@/lib/require-user";
import { FINANCE_VIEW_ROLES, canEditFees, hasRoleIn } from "@/lib/permissions";
import { ITEM_TYPES } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";
import { formatPlainDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";
import { Amount, MoneyResult } from "@/components/money/Money";
import { addPriceLock, endPriceLock } from "./actions";

type Lock = {
  id: string; studentId: string; nameAr: string; nameEn: string; studentNo: string; itemType: string; amount: string; reason: string;
  startsOn: string; endsOn: string | null; byName: string | null; isDemo: boolean; current: string | null;
};

/** Legacy prices (spec §8.4.2): every child keeping an older price, with who approved it. Also the report. */
export default async function PriceLocksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; ok?: string; done?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "view");
  const t = await getTranslations("money.locks");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, FINANCE_VIEW_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const locks = (await tx.execute(sql`
      select p.id, s.id as "studentId", s.full_name_ar as "nameAr", s.full_name_en as "nameEn", s.student_no as "studentNo", p.item_type as "itemType",
        p.amount_piastres::text as amount, p.reason, to_char(p.starts_on, 'YYYY-MM-DD') as "startsOn", to_char(p.ends_on, 'YYYY-MM-DD') as "endsOn",
        u.full_name as "byName", p.is_demo as "isDemo",
        (select i.monthly_amount_piastres::text from fee_list_item i join fee_list l on l.id = i.fee_list_id
          left join enrollment e on e.student_id = s.id and e.status = 'active' left join room r on r.id = e.room_id
          where l.branch_id = ${b.id} and i.item_type = p.item_type and l.effective_from <= ${today}::date
            and (l.effective_to is null or l.effective_to >= ${today}::date) and (i.age_band_id = r.age_band_id or i.age_band_id is null)
          order by i.age_band_id nulls last limit 1) as current
      from price_lock p join student s on s.id = p.student_id left join app_user u on u.id = p.approved_by
      where p.branch_id = ${b.id} order by (p.ends_on is null or p.ends_on >= ${today}::date) desc, s.full_name_en`)) as unknown as Lock[];
    const children = canEditFees(user, b.id)
      ? ((await tx.execute(sql`select id, full_name_ar as "ar", full_name_en as "en", student_no as no from student
          where branch_id = ${b.id} and status in ('active', 'pending') order by full_name_en`)) as unknown as { id: string; ar: string; en: string; no: string }[])
      : [];
    return { branches, b, locks, children };
  });
  if (!data) return <Card>{tm("noBranch")}</Card>;
  const { branches, b, locks, children } = data;
  const canEdit = canEditFees(user, b.id);
  const active = (l: Lock) => !l.endsOn || l.endsOn >= today;
  const back = `/settings/price-locks?branch=${b.id}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")} />
      <BranchTabs branches={branches} current={b.id} path="/settings/price-locks" locale={locale} label={tm("branch")} />
      <MoneyResult searchParams={sp} />
      <a href={`/api/export/price-locks?locale=${locale}&branch=${b.id}`} className={`${buttonClasses("secondary")} self-start`}>{tm("export")}</a>
      {locks.length === 0 ? <Card>{t("empty")}</Card> : null}
      {locks.map((l) => (
        <Card key={l.id} data-testid="price-lock">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/children/${l.studentId}`} className="font-semibold text-brand underline">{loc === "ar" ? l.nameAr : l.nameEn} · {l.studentNo}</Link>
            <span className="flex gap-2">
              {l.isDemo ? <Flag tone="attention">{tm("demo")}</Flag> : null}
              {active(l) ? <Flag tone="good">{t("active")}</Flag> : <Flag tone="neutral">{t("ended")}</Flag>}
            </span>
          </div>
          <p className="mt-1 text-[15px]">
            {tm(`items.${l.itemType}`)}: <Amount locale={locale} digits={user.digits} value={BigInt(l.amount)} />
            {l.current ? <span className="text-meta text-muted"> · {t("listPrice")} <Amount locale={locale} digits={user.digits} value={BigInt(l.current)} /></span> : null}
          </p>
          <p className="text-[14px]">{l.reason}</p>
          <p className="text-meta text-muted">
            {formatPlainDate(l.startsOn, loc, user.digits)} → {l.endsOn ? formatPlainDate(l.endsOn, loc, user.digits) : t("noEnd")} · {t("approvedBy", { name: l.byName ?? "—" })}
          </p>
          {canEdit && active(l) ? (
            <form action={endPriceLock} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="branchId" value={b.id} />
              <input type="hidden" name="id" value={l.id} />
              <input type="hidden" name="back" value={back} />
              <Field id={`end-${l.id}`} name="endsOn" type="date" label={t("endOn")} defaultValue={today} required />
              <Button type="submit" variant="secondary">{t("end")}</Button>
            </form>
          ) : null}
        </Card>
      ))}
      {canEdit ? (
        <Card>
          <h2 className="text-section-title font-semibold">{t("add")}</h2>
          <form action={addPriceLock} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="lock-form">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="branchId" value={b.id} />
            <input type="hidden" name="back" value={back} />
            <div className="sm:col-span-2">
              <SelectField id="lock-child" name="studentId" label={t("child")} required options={children.map((c) => ({ value: c.id, label: `${loc === "ar" ? c.ar : c.en} · ${c.no}` }))} />
            </div>
            <SelectField id="lock-type" name="itemType" label={t("item")} options={ITEM_TYPES.map((i) => ({ value: i, label: tm(`items.${i}`) }))} />
            <Field id="lock-amount" name="amount" label={t("amount")} inputMode="decimal" required />
            <Field id="lock-from" name="startsOn" type="date" label={t("from")} defaultValue={today} required />
            <Field id="lock-to" name="endsOn" type="date" label={t("to")} />
            <div className="sm:col-span-2">
              <Field id="lock-reason" name="reason" label={t("reason")} required minLength={3} maxLength={300} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">{t("save")}</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
