import { getTranslations } from "next-intl/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { ageBand, discountRule, feeList, feeListItem } from "@/db/schema";
import { requireMoney } from "@/lib/require-user";
import { DECIDER_ROLES, hasRoleIn } from "@/lib/permissions";
import { ITEM_TYPES, monthStart, shiftMonth } from "@/lib/billing";
import { todayInCairo } from "@/lib/calendar";
import { formatPiastres, formatPlainDate } from "@/lib/format";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, PageHeader, SelectField } from "@/components/settings/Fields";
import { BranchTabs, Flag, pickBranch } from "@/components/children/BranchTabs";
import { MoneyResult } from "@/components/money/Money";
import { addDiscount, saveFeeList, stopDiscount } from "./actions";

/** Fee lists with effective dates, and discounts (spec §8.4.1, §17.1). Owner and company manager. */
export default async function FeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; ok?: string; done?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireMoney(locale, "fees");
  const t = await getTranslations("money.fees");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const today = todayInCairo();

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, DECIDER_ROLES, b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const bands = await tx.select().from(ageBand).orderBy(asc(ageBand.sort));
    const lists = await tx.select().from(feeList).where(eq(feeList.branchId, b.id)).orderBy(desc(feeList.effectiveFrom));
    const items = lists.length ? await tx.select().from(feeListItem).where(inArray(feeListItem.feeListId, lists.map((l) => l.id))) : [];
    const discounts = await tx.select().from(discountRule).where(and(eq(discountRule.branchId, b.id))).orderBy(desc(discountRule.startsOn));
    return { branches, b, bands, lists, items, discounts };
  });
  if (!data) return <Card>{tm("noBranch")}</Card>;
  const { branches, b, bands, lists, items, discounts } = data;
  const current = lists.find((l) => l.effectiveFrom <= today && (!l.effectiveTo || l.effectiveTo >= today)) ?? null;
  const upcoming = lists.find((l) => l.effectiveFrom > today) ?? null;
  const base = upcoming ?? current;
  const amountOf = (listId: string | undefined, type: string, band: string | null) =>
    items.find((i) => i.feeListId === listId && i.itemType === type && i.ageBandId === band)?.monthlyAmountPiastres ?? null;
  const plain = (v: bigint | null) => (v === null ? "" : formatPiastres(v, "en", "latin").replace(/,/g, ""));
  const egp = (v: bigint | null) => (v === null ? "—" : formatPiastres(v, loc, user.digits));
  const defaultFrom = upcoming?.effectiveFrom ?? (current ? shiftMonth(today, 1) : monthStart(today));
  const rows: { key: string; type: string; band: string | null; label: string }[] = [
    ...bands.map((band) => ({ key: `fee:tuition:${band.id}`, type: "tuition", band: band.id, label: `${tm("items.tuition")} · ${localName(band, locale)}` })),
    { key: "fee:tuition:all", type: "tuition", band: null, label: `${tm("items.tuition")} · ${t("anyBand")}` },
    { key: "fee:registration:all", type: "registration", band: null, label: t("registrationOnce") },
    { key: "fee:transport:all", type: "transport", band: null, label: tm("items.transport") },
    { key: "fee:service:all", type: "service", band: null, label: tm("items.service") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} help={t("help")} />
      <BranchTabs branches={branches} current={b.id} path="/settings/fees" locale={locale} label={tm("branch")} />
      <MoneyResult searchParams={sp} />

      {!current && !upcoming ? <Card><p className="font-semibold text-critical">{t("noList")}</p></Card> : null}

      <Card>
        <h2 className="text-section-title font-semibold">{base === upcoming && upcoming ? t("editUpcoming") : t("newPrices")}</h2>
        <p className="mt-1 text-[14px] text-subtle">{t("formHelp")}</p>
        <form action={saveFeeList} className="mt-3 flex flex-col gap-3" data-testid="fee-form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="branchId" value={b.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="fee-from" name="effectiveFrom" type="date" label={t("from")} defaultValue={defaultFrom} min={monthStart(today)} required />
            <Field id="fee-name" name="name" label={t("name")} defaultValue={base?.name ?? ""} maxLength={80} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((r) => (
              <Field
                key={r.key}
                id={r.key.replace(/:/g, "-")}
                name={r.key}
                label={r.label}
                inputMode="decimal"
                defaultValue={plain(amountOf(base?.id, r.type, r.band))}
                placeholder={t("noFee")}
              />
            ))}
          </div>
          <p className="text-meta text-muted">{t("emptyMeans")}</p>
          <Button type="submit" data-testid="save-fees">{t("save")}</Button>
        </form>
      </Card>

      <h2 className="text-section-title font-semibold">{t("history")}</h2>
      {lists.length === 0 ? <Card>{t("noHistory")}</Card> : null}
      {lists.map((l) => (
        <Card key={l.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{l.name}</h3>
            <span className="flex gap-2">
              {l.isDemo ? <Flag tone="attention">{tm("demo")}</Flag> : null}
              {l.id === current?.id ? <Flag tone="good">{t("inForce")}</Flag> : l.effectiveFrom > today ? <Flag tone="attention">{t("upcoming")}</Flag> : <Flag tone="neutral">{t("ended")}</Flag>}
            </span>
          </div>
          <p className="text-meta text-muted">
            {formatPlainDate(l.effectiveFrom, loc, user.digits)} → {l.effectiveTo ? formatPlainDate(l.effectiveTo, loc, user.digits) : t("noEnd")}
          </p>
          <ul className="mt-2 grid gap-1 text-[14px] sm:grid-cols-2">
            {rows
              .filter((r) => amountOf(l.id, r.type, r.band) !== null)
              .map((r) => (
                <li key={r.key} className="flex justify-between gap-2">
                  <span>{r.label}</span>
                  <span className="figure" dir="ltr">{egp(amountOf(l.id, r.type, r.band))}</span>
                </li>
              ))}
          </ul>
        </Card>
      ))}

      <h2 className="text-section-title font-semibold">{t("discounts")}</h2>
      <p className="text-[14px] text-subtle">{t("discountsHelp")}</p>
      {discounts.length === 0 ? <Card>{t("noDiscounts")}</Card> : null}
      {discounts.map((d) => (
        <Card key={d.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{d.name}</span>
            {d.isActive && (!d.endsOn || d.endsOn >= today) ? <Flag tone="good">{t("active")}</Flag> : <Flag tone="neutral">{t("ended")}</Flag>}
          </div>
          <p className="text-[14px]">
            {d.type === "percent" ? `${Number(d.value) / 100}%` : egp(d.value)} · {tm(`items.${d.appliesTo}`)} · {formatPlainDate(d.startsOn, loc, user.digits)} →{" "}
            {d.endsOn ? formatPlainDate(d.endsOn, loc, user.digits) : t("noEnd")}
          </p>
          {d.isActive ? (
            <form action={stopDiscount} className="mt-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="branchId" value={b.id} />
              <input type="hidden" name="id" value={d.id} />
              <Button type="submit" variant="secondary">{t("stop")}</Button>
            </form>
          ) : null}
        </Card>
      ))}
      <Card>
        <h3 className="font-semibold">{t("addDiscount")}</h3>
        <form action={addDiscount} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="branchId" value={b.id} />
          <Field id="disc-name" name="name" label={t("discountName")} required minLength={2} maxLength={80} />
          <SelectField id="disc-type" name="type" label={t("discountType")} options={[{ value: "percent", label: t("percent") }, { value: "amount", label: t("fixedAmount") }]} />
          <Field id="disc-value" name="value" label={t("discountValue")} inputMode="decimal" required />
          <SelectField id="disc-applies" name="appliesTo" label={t("appliesTo")} options={ITEM_TYPES.map((i) => ({ value: i, label: tm(`items.${i}`) }))} />
          <Field id="disc-from" name="startsOn" type="date" label={t("from")} defaultValue={shiftMonth(today, 1)} required />
          <Field id="disc-to" name="endsOn" type="date" label={t("to")} />
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary">{t("addDiscount")}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
