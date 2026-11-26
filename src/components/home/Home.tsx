import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/Card";
import { DataStatusChip } from "@/components/closing/DataStatusChip";
import { monthLabel } from "@/components/money/Money";
import { formatNumber, formatPiastres, formatPiastresCompact, formatPlainDate, formatTimestamp, type Digits, type Locale } from "@/lib/format";
import type { DataStatus } from "@/components/ui/StatusChip";
import type { AttentionItem, Sentence } from "@/lib/home";

type Branch = { id: string; nameAr: string; nameEn: string };

/** A short amount for tiles: "EGP 663.4K" / "٦٦٣٫٤ ألف ج.م". Integer piastres all the way (rule 5). */
export async function CompactMoney({ value, locale, digits }: { value: bigint; locale: Locale; digits: Digits }) {
  const tMoney = await getTranslations("money");
  const v = formatPiastresCompact(value, locale, digits);
  return (
    <span className="figure whitespace-nowrap" dir={locale === "ar" ? "rtl" : "ltr"}>
      {locale === "ar" ? (
        <>
          {v} <span className="text-[13px] font-medium text-muted">{tMoney("egp")}</span>
        </>
      ) : (
        <>
          <span className="text-[13px] font-medium text-muted">{tMoney("egp")}</span> {v}
        </>
      )}
    </span>
  );
}

/** One figure on Home (spec §11.2 item 6): label, value, one line of context, status chip; tap opens its detail. */
export function Tile({
  id,
  href,
  label,
  value,
  context,
  status,
  wide = false,
}: {
  id: string;
  href: string;
  label: string;
  value: React.ReactNode;
  context?: React.ReactNode;
  status?: DataStatus;
  wide?: boolean;
}) {
  return (
    <li className={wide ? "col-span-2" : undefined}>
      <Link
        href={href}
        data-testid={`tile-${id}`}
        className="flex h-full min-h-28 flex-col gap-1 rounded-card border border-border bg-surface p-3 hover:bg-bg focus-visible:bg-bg"
      >
        <span className="text-meta text-subtle">{label}</span>
        <span className="text-[22px] leading-tight font-semibold">{value}</span>
        {context ? <span className="text-meta text-muted">{context}</span> : null}
        {status ? (
          <span className="mt-auto pt-1">
            <DataStatusChip status={status} />
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export function TileGroup({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby={`g-${id}`} data-testid={`group-${id}`}>
      <h2 id={`g-${id}`} className="text-section-title font-semibold">
        {title}
      </h2>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</ul>
    </section>
  );
}

/** "Today at a glance": fixed template sentences built from today's records (spec §9.7). */
export async function BriefingCard({ sentences, locale, digits }: { sentences: Sentence[]; locale: Locale; digits: Digits }) {
  const t = await getTranslations("home");
  const n = (v: number) => formatNumber(v, locale, digits);
  const list = (xs: string[]) => new Intl.ListFormat(locale === "ar" ? "ar" : "en", { style: "long", type: "conjunction" }).format(xs);
  const text = (s: Sentence) => {
    const v: Record<string, string | number> = {};
    for (const [k, x] of Object.entries(s.values)) {
      if (Array.isArray(x)) v[k] = list(x);
      else if (typeof x === "bigint") v[k] = formatPiastres(x, locale, digits);
      else if (k === "date" && typeof x === "string") v[k] = formatPlainDate(x, locale, digits);
      else if (k === "pct" && typeof x === "string") v[k] = new Intl.NumberFormat(`${locale === "ar" ? "ar-EG" : "en-EG"}-u-nu-${digits === "arabic" ? "arab" : "latn"}`, { maximumFractionDigits: 1 }).format(x as unknown as number);
      else if (typeof x === "number") v[k] = k === "count" || k === "families" ? x : n(x);
      else v[k] = x;
    }
    // Plural keys keep the raw count; the shown number is formatted for the person's digits.
    if (typeof s.values.count === "number") v.n = n(s.values.count);
    if (typeof s.values.families === "number") v.n = n(s.values.families);
    if (typeof s.values.classes === "number") v.classes = n(s.values.classes);
    return t(`brief.${s.key}` as "brief.notWorking", v);
  };
  return (
    <section className="rounded-card bg-brand p-4 text-white" aria-labelledby="briefing-title" data-testid="briefing">
      <h2 id="briefing-title" className="text-section-title font-semibold">
        {t("briefingTitle")}
      </h2>
      <ul className="mt-2 flex flex-col gap-1.5 text-[15px] leading-relaxed">
        {sentences.map((s, i) => (
          <li key={`${s.key}-${i}`} data-testid={`brief-${s.key}`}>
            {text(s)}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-meta text-brand-on-dark">{t("briefingFoot")}</p>
    </section>
  );
}

/** Rows of "Requires your attention" (spec §11.2 item 5): chip, meta, title, detail and one action button. */
export async function AttentionList({
  items,
  branches,
  locale,
  digits,
  limit,
  total,
}: {
  items: AttentionItem[];
  branches: Branch[];
  locale: Locale;
  digits: Digits;
  limit?: number;
  total: number;
}) {
  const t = await getTranslations("home");
  const ts = await getTranslations("safety");
  const tm = await getTranslations("money");
  const n = (v: number) => formatNumber(v, locale, digits);
  const money = (v: bigint) => formatPiastres(v, locale, digits);
  const shown = limit ? items.slice(0, limit) : items;
  const branchName = (id: string) => {
    const b = branches.find((x) => x.id === id);
    return b ? (locale === "ar" ? b.nameAr : b.nameEn) : "";
  };
  const when = (iso: string) => (iso.endsWith("T00:00:00.000Z") ? formatPlainDate(iso.slice(0, 10), locale, digits) : formatTimestamp(new Date(iso), locale, digits));

  function words(a: AttentionItem): { title: string; detail?: string } {
    const v = a.values;
    const k = `kinds.${a.kind}` as const;
    switch (a.kind) {
      case "critical_incident":
        return { title: t(`${k}.title` as "kinds.critical_incident.title", { category: ts(`category.${v.category}` as "category.other") }) };
      case "approval":
        return {
          title: t("kinds.approval.title", { type: tm(`requestTypes.${v.type}` as "requestTypes.expense") }),
          detail: t("kinds.approval.detail", { amount: money(v.amount as bigint) }),
        };
      case "reopen":
        return { title: t("kinds.reopen.title", { month: monthLabel(String(v.month), locale, digits) }), detail: t("kinds.reopen.detail") };
      case "over_capacity":
        return { title: t("kinds.over_capacity.title") };
      case "overdue_family":
        return {
          title: t("kinds.overdue_family.title", { account: String(v.account), family: String(v.family) }),
          detail: t("kinds.overdue_family.detail", { amount: money(v.amount as bigint), invoices: Number(v.invoices), nInvoices: n(Number(v.invoices)), days: n(Number(v.days)) }),
        };
      case "ratio_breach":
        return {
          title: t("kinds.ratio_breach.title", { count: Number(v.count), n: n(Number(v.count)) }),
          detail: t("kinds.ratio_breach.detail", { classes: String(locale === "ar" ? v.classesAr : v.classesEn) }),
        };
      case "close_missing":
        return { title: t("kinds.close_missing.title", { date: formatPlainDate(String(v.date), locale, digits) }) };
      case "expense_rise":
        return {
          title: t("kinds.expense_rise.title", { category: String(locale === "ar" ? v.categoryAr : v.categoryEn) }),
          detail: t("kinds.expense_rise.detail", { amount: money(v.amount as bigint), average: money(v.average as bigint) }),
        };
      case "occupancy_drop":
        return {
          title: t("kinds.occupancy_drop.title", { before: n(Number(v.before)), now: n(Number(v.now)) }),
          detail: t("kinds.occupancy_drop.detail", { licensed: n(Number(v.licensed)) }),
        };
      case "cash_variance":
        return {
          title: t("kinds.cash_variance.title", { date: formatPlainDate(String(v.date), locale, digits) }),
          detail: t("kinds.cash_variance.detail", { amount: money(v.amount as bigint) }),
        };
    }
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="attention-title" data-testid="attention">
      <h2 id="attention-title" className="flex items-center gap-2 text-section-title font-semibold">
        {t("attentionTitle")}
        <span className="figure inline-flex min-w-6 justify-center rounded-full bg-attention-bg px-2 text-meta font-semibold text-attention" data-testid="attention-count">
          {n(total)}
        </span>
      </h2>
      {total === 0 ? <Card>{t("attentionNone")}</Card> : null}
      {shown.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
          {shown.map((a) => {
            const w = words(a);
            const critical = a.kind === "critical_incident";
            return (
              <li key={`${a.kind}-${a.id}`} className="flex flex-col gap-1.5 p-4" data-testid="attention-row" data-kind={a.kind}>
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-chip px-2 py-0.5 text-meta font-medium ${critical ? "bg-critical-bg text-critical" : "bg-attention-bg text-attention"}`}
                  >
                    {t(`kinds.${a.kind}.chip` as "kinds.approval.chip")}
                  </span>
                  <span className="figure text-meta text-muted">{t("attentionMeta", { branch: branchName(a.branchId), when: when(a.at) })}</span>
                </span>
                <span className="font-semibold">{w.title}</span>
                {w.detail ? <span className="figure text-[14px] text-subtle">{w.detail}</span> : null}
                <Link
                  href={a.href}
                  className={`mt-1 inline-flex min-h-11 w-fit items-center rounded-button px-4 text-[14px] font-semibold ${
                    critical ? "bg-critical text-white hover:opacity-90" : "border border-outline bg-surface text-ink hover:bg-bg"
                  }`}
                >
                  {t(`kinds.${a.kind}.action` as "kinds.approval.action")}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      {limit && total > shown.length ? (
        <Link href="/inbox" className="inline-flex min-h-11 items-center font-semibold text-brand underline" data-testid="attention-more">
          {t("attentionMore", { n: n(total - shown.length) })}
        </Link>
      ) : null}
    </section>
  );
}
