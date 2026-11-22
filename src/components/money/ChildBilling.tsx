import { getTranslations } from "next-intl/server";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { priceLock, studentService } from "@/db/schema";
import { canEditChildren, canEditFees } from "@/lib/permissions";
import { OPTIONAL_ITEMS, monthEnd, shiftMonth } from "@/lib/billing";
import { formatPlainDate, type Digits } from "@/lib/format";
import type { CurrentUser } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Flag } from "@/components/children/BranchTabs";
import { Amount } from "./Money";
import { setService } from "@/app/[locale]/(app)/children/[id]/billing-actions";

/** Billing on the child's page: what the family owes, a legacy price, and transport or other services. */
export async function ChildBilling({
  user,
  studentId,
  branchId,
  familyId,
  locale,
  today,
}: {
  user: CurrentUser;
  studentId: string;
  branchId: string;
  familyId: string;
  locale: string;
  today: string;
}) {
  const t = await getTranslations("money.child");
  const tm = await getTranslations("money");
  const loc = locale === "en" ? "en" : "ar";
  const digits: Digits = user.digits;
  const data = await withUserDb(user.id, async (tx) => {
    const [owed] = (await tx.execute(sql`
      select coalesce(sum(total_piastres - paid_piastres - credited_piastres), 0)::text as owed,
        coalesce(sum(total_piastres - paid_piastres - credited_piastres) filter (where due_date < ${today}::date and kind <> 'late_fee'), 0)::text as overdue
      from invoice where family_id = ${familyId} and status <> 'paid'`)) as unknown as { owed: string; overdue: string }[];
    const locks = await tx
      .select()
      .from(priceLock)
      .where(and(eq(priceLock.studentId, studentId), or(isNull(priceLock.endsOn), gte(priceLock.endsOn, today))));
    const services = await tx.select().from(studentService).where(and(eq(studentService.studentId, studentId), or(isNull(studentService.endsOn), gte(studentService.endsOn, today))));
    return { owed: BigInt(owed.owed), overdue: BigInt(owed.overdue), locks, services };
  });
  const canToggle = canEditChildren(user, branchId) || canEditFees(user, branchId);
  const nextMonth = shiftMonth(today, 1);

  return (
    <Card className="flex flex-col gap-3" data-testid="child-billing">
      <h2 className="text-section-title font-semibold">{t("title")}</h2>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{t("familyOwes")}: <span className="font-semibold"><Amount locale={locale} digits={digits} value={data.owed} /></span></span>
        {data.overdue > 0n ? <Flag tone="critical">{t("overdue")}: {""}<Amount locale={locale} digits={digits} value={data.overdue} /></Flag> : null}
      </div>
      <Link href={`/payment?branch=${branchId}&family=${familyId}`} className="text-[14px] text-brand underline">{t("statement")}</Link>
      {data.locks.map((l) => (
        <p key={l.id} className="text-[14px]">
          <Flag tone="neutral">{t("legacyPrice")}</Flag> {tm(`items.${l.itemType}`)} <Amount locale={locale} digits={digits} value={l.amountPiastres} /> · {l.reason}
          {l.endsOn ? ` · ${t("until", { date: formatPlainDate(l.endsOn, loc, digits) })}` : ""}
        </p>
      ))}
      <ul className="flex flex-col gap-2">
        {OPTIONAL_ITEMS.map((item) => {
          const s = data.services.find((x) => x.itemType === item);
          const on = !!s && s.startsOn <= today;
          const planned = !!s && s.startsOn > today;
          return (
            <li key={item} className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
              <span>
                {tm(`items.${item}`)}:{" "}
                {s?.endsOn
                  ? t("endsOn", { date: formatPlainDate(s.endsOn, loc, digits) })
                  : on
                    ? t("on")
                    : planned
                      ? t("startsOn", { date: formatPlainDate(s!.startsOn, loc, digits) })
                      : t("off")}
              </span>
              {canToggle && !s?.endsOn ? (
                <form action={setService} className="flex items-center gap-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="itemType" value={item} />
                  <input type="hidden" name="on" value={s ? "0" : "1"} />
                  <input type="hidden" name="date" value={s ? monthEnd(today) : nextMonth} />
                  <Button type="submit" variant="secondary" data-testid={`service-${item}`}>
                    {s ? t("stopEndOfMonth") : t("startNextMonth")}
                  </Button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
