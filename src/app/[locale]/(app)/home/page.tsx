import { getTranslations } from "next-intl/server";
import { withUserDb } from "@/db/rls";
import { homeScope, homeView, pick } from "@/db/home-view";
import { requireSection } from "@/lib/require-user";
import { todayInCairo, cairoTimeOf } from "@/lib/calendar";
import { formatDateTime, formatNumber, formatPiastresCompact, type Locale } from "@/lib/format";
import type { Kpi } from "@/lib/data-status";
import { Card } from "@/components/ui/Card";
import { BranchTabs } from "@/components/children/BranchTabs";
import { monthLabel } from "@/components/money/Money";
import { StatusLegend } from "@/components/StatusLegend";
import { AttentionList, BriefingCard, CompactMoney, Tile, TileGroup } from "@/components/home/Home";
import { HOME_ATTENTION_ROWS } from "@/lib/home";

/**
 * The owner's Home (spec §11.2): greeting, branch switcher, freshness, today's briefing, what needs a decision,
 * and the four groups of figures. Every figure is read from records with its data status; nothing is typed in.
 */
export default async function HomePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ branch?: string }> }) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireSection(locale, "home");
  const t = await getTranslations("home");
  const tc = await getTranslations("closing");
  const tf = await getTranslations("closing.figures");
  const loc: Locale = locale === "en" ? "en" : "ar";
  const today = todayInCairo();
  const now = new Date();

  const data = await withUserDb(user.id, async (tx) => {
    const scope = await homeScope(tx, user, sp.branch, { ar: tc("allBranches"), en: tc("allBranches") });
    if (!scope) return null;
    return { scope, view: await homeView(tx, user, scope.parts, scope.branches, scope.money, today, loc) };
  });
  if (!data) return <Card>{tc("noBranch")}</Card>;
  const { scope, view } = data;
  const { figures, result, closedMonth } = view;
  const n = (v: number | bigint) => formatNumber(v, loc, user.digits);
  const q = `?branch=${scope.current.id}`;
  const hour = Number(cairoTimeOf(now).slice(0, 2));
  const greeting = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const firstName = (user.name ?? "").split(" ")[0];
  const pct = (v: string) => `${new Intl.NumberFormat(`${loc === "ar" ? "ar-EG" : "en-EG"}-u-nu-${user.digits === "arabic" ? "arab" : "latn"}`, { maximumFractionDigits: 1 }).format(v as unknown as number)}%`;
  const big = (v: string | null) => BigInt((v ?? "0").split(".")[0]);
  const egp = (await getTranslations("money"))("egp");
  const cm = (v: bigint) => (loc === "ar" ? `${formatPiastresCompact(v, loc, user.digits)} ${egp}` : `${egp} ${formatPiastresCompact(v, loc, user.digits)}`);

  const value = (k: Kpi | undefined) => {
    if (!k || k.value === null) return <span className="figure" aria-label={tf("notSubmitted")}>—</span>;
    if (k.kind === "piastres") return <CompactMoney value={big(k.value)} locale={loc} digits={user.digits} />;
    if (k.kind === "percent") return <span className="figure" dir="ltr">{pct(k.value)}</span>;
    if (k.kind === "rate") return <span className="figure">{pct(k.value).replace("%", "")}</span>;
    return <span className="figure">{n(big(k.value))}</span>;
  };
  const missing = (k: Kpi | undefined, id: string) =>
    k && k.value === null ? (tf.has(`missing.${id}`) ? tf(`missing.${id}` as "missing.close_day") : tf("missingGeneric")) : null;
  const f = (key: string) => pick(figures, key);
  const tile = (key: string) => `/home/${key.replace(/\./g, "_")}${q}`;

  const att = f("attendance.day");
  const staff = f("staff.present");
  const ratio = f("ratio.breaches");
  const overdue = f("money.overdue");
  const occ = f("children.occupancy");
  const rate = f("incidents.rate");
  const res = result ? pick(result, "money.result") : undefined;
  const resBilled = result ? pick(result, "money.billed") : undefined;
  const resCosts = result ? pick(result, "money.expenses") : undefined;
  const month = monthLabel(`${today.slice(0, 7)}-01`, locale, user.digits);
  const licensed = scope.parts.reduce((s, b) => s + (b.licensed ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-meta text-muted">{formatDateTime(now, loc, user.digits)}</p>
        <h1 className="text-page-title font-semibold" data-testid="greeting">{t(`greeting.${greeting}`, { name: firstName })}</h1>
      </header>

      <BranchTabs branches={scope.tabs} current={scope.current.id} path="/home" locale={locale} label={t("branch")} />

      <p className="figure text-meta text-muted" data-testid="freshness">
        {t("updated", { time: cairoTimeOf(now).slice(0, 5) })} ·{" "}
        {t("daysClosed", {
          month: monthLabel(`${today.slice(0, 7)}-01`, locale, user.digits),
          list: view.closeRates
            .map((r) => t("daysClosedItem", { branch: loc === "ar" ? r.branch.nameAr : r.branch.nameEn, done: n(r.done), total: n(r.total) }))
            .join(loc === "ar" ? "، " : ", "),
        })}
      </p>

      <BriefingCard sentences={view.briefing} locale={loc} digits={user.digits} />

      <AttentionList
        items={view.attention}
        branches={scope.branches}
        locale={loc}
        digits={user.digits}
        limit={HOME_ATTENTION_ROWS}
        total={view.attention.length}
      />

      {scope.money ? (
        <TileGroup title={t("groups.money")} id="money">
          <Tile id="money_billed" href={tile("money.billed")} label={t("tiles.money_billed")} value={value(f("money.billed"))} context={t("ctx.month", { month })} status={f("money.billed")?.status} />
          <Tile id="money_collected" href={tile("money.collected")} label={t("tiles.money_collected")} value={value(f("money.collected"))} context={t("ctx.month", { month })} status={f("money.collected")?.status} />
          <Tile id="money_collection_rate" href={tile("money.collection_rate")} label={t("tiles.money_collection_rate")} value={value(f("money.collection_rate"))} context={t("ctx.collectionRate")} status={f("money.collection_rate")?.status} />
          <Tile
            id="money_overdue"
            href={tile("money.overdue")}
            label={t("tiles.money_overdue")}
            value={value(overdue)}
            context={overdue?.den ? t("ctx.families", { count: Number(overdue.den), n: n(Number(overdue.den)) }) : undefined}
            status={overdue?.status}
          />
          <Tile
            id="money_result"
            wide
            href={tile("money.result")}
            label={closedMonth ? t("tiles.money_result", { month: monthLabel(closedMonth, locale, user.digits) }) : t("ctx.resultTitleNone")}
            value={res ? value(res) : "—"}
            context={
              res && resBilled && resCosts ? (
                <span className="figure">
                  {t("ctx.resultLine", { billed: cm(big(resBilled.value)), costs: cm(big(resCosts.value)) })}
                </span>
              ) : (
                t("ctx.noClosedMonth")
              )
            }
            status={res?.status ?? "notSubmitted"}
          />
        </TileGroup>
      ) : null}

      <TileGroup title={t("groups.children")} id="children">
        <Tile id="children_active" href={tile("children.active")} label={t("tiles.children_active")} value={value(f("children.active"))} context={t("ctx.licensed", { n: n(licensed) })} status={f("children.active")?.status} />
        <Tile id="children_occupancy" href={tile("children.occupancy")} label={t("tiles.children_occupancy")} value={value(occ)} context={t("ctx.ofLicensed", { n: n(licensed) })} status={occ?.status} />
        <Tile
          id="attendance_day"
          href={tile("attendance.day")}
          label={t("tiles.attendance_day")}
          value={value(att)}
          context={
            missing(att, "attendance_day") ??
            (att ? t("ctx.attendance", { present: n(big(att.num)), expected: n(big(att.den)), done: n(att.done ?? 0), total: n(att.total ?? 0) }) : undefined)
          }
          status={att?.status}
        />
        <Tile
          id="waitlist"
          href={`/children/waitlist${q === "?branch=all" ? "" : q}`}
          label={t("tiles.waitlist")}
          value={<span className="figure">{n(view.waitTotal)}</span>}
          context={view.waitTotal ? view.waitBands.map(([b, c]) => `${b} ${n(c)}`).join(loc === "ar" ? "، " : ", ") : t("ctx.nobodyWaiting")}
          status="provisional"
        />
      </TileGroup>

      <TileGroup title={t("groups.team")} id="team">
        <Tile
          id="staff_present"
          href={tile("staff.present")}
          label={t("tiles.staff_present")}
          value={value(staff)}
          context={missing(staff, "staff_present") ?? (staff?.den ? t("ctx.ofStaff", { n: n(big(staff.den)) }) : undefined)}
          status={staff?.status}
        />
        <Tile
          id="ratio_breaches"
          href={tile("ratio.breaches")}
          label={t("tiles.ratio_breaches")}
          value={value(ratio)}
          context={ratio?.total ? t("ctx.classesChecked", { done: n(ratio.done ?? 0), total: n(ratio.total) }) : undefined}
          status={ratio?.status}
        />
      </TileGroup>

      <TileGroup title={t("groups.safety")} id="safety">
        <Tile id="incidents_open_critical" href={tile("incidents.open_critical")} label={t("tiles.incidents_open_critical")} value={value(f("incidents.open_critical"))} status={f("incidents.open_critical")?.status} />
        <Tile
          id="incidents_month"
          href={tile("incidents.month")}
          label={t("tiles.incidents_month")}
          value={value(f("incidents.month"))}
          context={rate?.value ? t("ctx.perHundred", { rate: pct(rate.value).replace("%", "") }) : undefined}
          status={f("incidents.month")?.status}
        />
        <Tile id="approvals" href="/inbox" label={t("tiles.approvals")} value={<span className="figure">{n(view.approvals)}</span>} context={t("ctx.forYou")} status="provisional" />
        <Tile id="actions_overdue" href={tile("actions.overdue")} label={t("tiles.actions_overdue")} value={value(f("actions.overdue"))} context={t("ctx.pastDue")} status={f("actions.overdue")?.status} />
      </TileGroup>

      <StatusLegend />
    </div>
  );
}
