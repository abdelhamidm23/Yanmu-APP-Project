import "server-only";
import type { Tx } from "./rls";
import { visibleBranches } from "./children";
import { attentionItems, classesNotDone, closeTime, daysNotClosed, isWorking, kpisByBranch, lastClosedMonth, monthEnd, waitlist, type HomeBranch } from "./home";
import { CLOSE_VIEW_ROLES, canViewMonth, hasRoleIn } from "@/lib/permissions";
import { consolidate, type Kpi } from "@/lib/data-status";
import { buildBriefing, rankAttention, type AttentionItem, type BriefingInput, type Sentence } from "@/lib/home";
import { pickBranch } from "@/components/children/BranchTabs";
import type { CurrentUser } from "@/lib/session";

export type Scope = { id: string; nameAr: string; nameEn: string };

/** The branches a person sees on Home, and the one chosen ("all" when they see several). */
export async function homeScope(tx: Tx, user: CurrentUser, requested: string | undefined, allLabel: { ar: string; en: string }) {
  const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, CLOSE_VIEW_ROLES, b.id)) as (HomeBranch & { physical: number | null })[];
  if (branches.length === 0) return null;
  const tabs: Scope[] = branches.length > 1 ? [{ id: "all", nameAr: allLabel.ar, nameEn: allLabel.en }, ...branches] : branches;
  const current = pickBranch(tabs, requested)!;
  const parts = current.id === "all" ? branches : branches.filter((b) => b.id === current.id);
  return { branches, tabs, current, parts, money: parts.every((b) => canViewMonth(user, b.id)) };
}

export const combine = (per: Map<string, Kpi[]>, ids: string[]): Kpi[] => (ids.length === 1 ? per.get(ids[0])! : consolidate(ids.map((id) => per.get(id)!)));
export const pick = (ks: Kpi[], key: string) => ks.find((k) => k.key === key);
const num = (v: string | null | undefined) => (v == null ? 0 : Number(v.split(".")[0]));

/** Everything the owner's Home shows for a scope (spec §11.2). */
export async function homeView(tx: Tx, user: CurrentUser, parts: HomeBranch[], all: HomeBranch[], money: boolean, today: string, locale: "ar" | "en") {
  const ids = parts.map((b) => b.id);
  const per = await kpisByBranch(tx, ids, today);
  const figures = combine(per, ids);

  // Operating result of the last month every branch has closed (Verified).
  const closedMonth = money ? await lastClosedMonth(tx, ids) : null;
  const result = closedMonth ? combine(await kpisByBranch(tx, ids, monthEnd(closedMonth)), ids) : null;

  const waits = await Promise.all(parts.map((b) => waitlist(tx, b.id)));
  const waitTotal = waits.flat().reduce((s, w) => s + w.n, 0);
  const waitBands = new Map<string, number>();
  for (const w of waits.flat()) {
    const name = locale === "ar" ? w.nameAr : w.nameEn;
    waitBands.set(name, (waitBands.get(name) ?? 0) + w.n);
  }

  // The briefing (spec §9.7), consolidated over the scope.
  const multi = parts.length > 1;
  const name = (b: HomeBranch) => (locale === "ar" ? b.nameAr : b.nameEn);
  const input: BriefingInput = {
    working: false,
    attendance: { present: 0, expected: 0, classesDone: 0, classes: 0, missingClasses: [] },
    incidents: { today: 0, confirmedNone: true, closeTime: "19:00" },
    openCritical: 0,
    money: money ? { collected: 0n, overdueFamilies: 0 } : null,
    staff: { uploaded: true, absent: 0 },
    ratioBreaches: 0,
    notClosed: [],
  };
  for (const b of parts) {
    const ks = per.get(b.id)!;
    const working = await isWorking(tx, b.id, today);
    const att = pick(ks, "attendance.day")!;
    const crit = pick(ks, "incidents.open_critical");
    input.openCritical += num(crit?.value);
    if (input.money) {
      input.money.collected += BigInt(num(pick(ks, "money.collected")?.value));
      input.money.overdueFamilies += num(pick(ks, "money.overdue")?.den);
    }
    for (const d of await daysNotClosed(tx, b.id, today)) input.notClosed.push({ branch: name(b), date: d.date });
    if (!working) continue;
    input.working = true;
    input.incidents.closeTime = await closeTime(tx, b.id);
    input.attendance.present += num(att.num);
    input.attendance.expected += num(att.den);
    input.attendance.classesDone += att.done ?? 0;
    input.attendance.classes += att.total ?? 0;
    if ((att.done ?? 0) < (att.total ?? 0) && (att.done ?? 0) > 0)
      for (const c of await classesNotDone(tx, b.id, today))
        input.attendance.missingClasses.push(multi ? `${name(b)} ${locale === "ar" ? c.nameAr : c.nameEn}` : locale === "ar" ? c.nameAr : c.nameEn);
    const inc = pick(ks, "incidents.day")!;
    input.incidents.today += num(inc.value);
    if (inc.status !== "confirmed") input.incidents.confirmedNone = false;
    const staff = pick(ks, "staff.present")!;
    if (staff.status === "notSubmitted") input.staff.uploaded = false;
    else input.staff.absent += Math.max(0, num(staff.den) - num(staff.num));
    input.ratioBreaches += num(pick(ks, "ratio.breaches")?.value);
  }
  // Classes still to mark when nobody has started are told by the "none yet" sentence.
  if (input.attendance.classesDone === 0) input.attendance.missingClasses = [];
  const briefing: Sentence[] = buildBriefing(input);

  const attention: AttentionItem[] = rankAttention(await attentionItems(tx, user, parts, today));
  const approvals = attention.filter((a) => a.kind === "approval" || a.kind === "reopen" || a.kind === "over_capacity").length;

  // Freshness (spec §6.4): days closed this month per branch.
  const closeRates = parts.map((b) => {
    const k = pick(per.get(b.id)!, "close.rate")!;
    return { branch: b, done: k.done ?? 0, total: k.total ?? 0 };
  });
  void all;
  return { per, figures, closedMonth, result, waitTotal, waitBands: [...waitBands.entries()], briefing, attention, approvals, closeRates };
}
