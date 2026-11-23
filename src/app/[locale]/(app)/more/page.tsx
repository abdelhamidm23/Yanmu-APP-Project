import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireSection } from "@/lib/require-user";
import { canOpenSettings, isOrgAdmin, canOpenToday, canViewMoney, canViewPayStatus, canUseCashBox, canReconcileCash, canDecideMoney, canViewExpenses, canTakeAttendance, canViewChildren, canViewStaff, canViewStaffAttendance, canOpenSafety } from "@/lib/permissions";
import { canOpenSection, requiresMfa } from "@/lib/roles";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClasses } from "@/components/ui/Button";
import { forgetPin, savePreferences, setUpPin, switchRole } from "./actions";
import { SignOutButton } from "./SignOutButton";
import { SettingsMenu } from "@/components/settings/SettingsMenu";
import { PushToggle } from "@/components/alerts/PushToggle";

function Segment({ name, options, value }: { name: string; options: { value: string; label: string; lang?: string }[]; value: string }) {
  return (
    <div className="inline-flex rounded-button bg-segment-bg p-1">
      {options.map((o) => (
        <label key={o.value} className="cursor-pointer">
          <input type="radio" name={name} value={o.value} defaultChecked={o.value === value} className="peer sr-only" />
          <span
            lang={o.lang}
            className="figure inline-flex min-h-11 min-w-20 items-center justify-center rounded-segment px-3 text-[14px] font-medium text-ink peer-checked:bg-brand peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-brand"
          >
            {o.label}
          </span>
        </label>
      ))}
    </div>
  );
}

export default async function MorePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; pin?: string }>;
}) {
  const { locale } = await params;
  const { saved, pin } = await searchParams;
  const user = await requireSection(locale, "more");
  const t = await getTranslations();
  const hasTab = (section: string) => Boolean(user.activeRole && canOpenSection(user.activeRole, section));
  const dailyLinks = [
    { show: canOpenToday(user) && !hasTab("today"), href: "/today", title: t("today.title"), text: t("more.todayLink"), id: "open-today" },
    { show: canTakeAttendance(user) && !hasTab("roll-call"), href: "/roll-call", title: t("attendance.rollCallTitle"), text: t("more.rollCallLink"), id: "open-roll-call" },
    { show: canViewChildren(user) && !hasTab("children"), href: "/children", title: t("more.children"), text: t("more.childrenLink"), id: "open-children" },
    { show: canViewStaff(user) && !hasTab("staff"), href: "/staff", title: t("staff.title"), text: t("more.staffLink"), id: "open-staff" },
    { show: canOpenSafety(user), href: "/incidents", title: t("safety.incidents.title"), text: t("more.incidentsLink"), id: "open-incidents" },
    { show: canOpenSafety(user) && !hasTab("issues"), href: "/issues", title: t("safety.issues.title"), text: t("more.issuesLink"), id: "open-issues" },
    { show: !hasTab("inbox"), href: "/inbox", title: t("alerts.inboxTitle"), text: t("more.alertsLink"), id: "open-alerts" },
    { show: canViewStaffAttendance(user) && !hasTab("staff-attendance"), href: "/staff-attendance", title: t("staffAttendance.title"), text: t("more.staffAttendanceLink"), id: "open-staff-attendance" },
  ].filter((l) => l.show);
  // Money (Phase 4): the screens a role reaches beyond its own tabs.
  const moneyLinks = [
    { show: canViewPayStatus(user) && !canViewMoney(user) && !hasTab("paid"), href: "/paid", title: t("money.paid.title"), text: t("more.paidLink"), id: "open-paid" },
    { show: canViewMoney(user) && !hasTab("money"), href: "/money", title: t("money.title"), text: t("more.moneyLink"), id: "open-money" },
    { show: canViewMoney(user) && !hasTab("invoices"), href: "/invoices", title: t("money.links.invoices"), text: t("more.invoicesLink"), id: "open-invoices" },
    { show: canViewMoney(user), href: "/payments", title: t("money.links.payments"), text: t("more.paymentsLink"), id: "open-payments" },
    {
      show: (canUseCashBox(user) || canReconcileCash(user) || canDecideMoney(user)) && !hasTab("cash-box"),
      href: "/cash-box",
      title: t("money.links.cashBox"),
      text: t("more.cashBoxLink"),
      id: "open-cash-box",
    },
    { show: canViewExpenses(user), href: "/expenses", title: t("money.links.expenses"), text: t("more.expensesLink"), id: "open-expenses" },
    { show: canViewMoney(user) && !isOrgAdmin(user), href: "/settings/price-locks", title: t("money.links.priceLocks"), text: t("more.priceLocksLink"), id: "open-price-locks" },
  ].filter((l) => l.show);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold">{t("nav.more")}</h1>
      {saved ? <Alert tone="good">{t("more.saved")}</Alert> : null}

      {dailyLinks.length > 0 ? (
        <section className="flex flex-col gap-2" data-testid="more-group-daily">
          <h2 className="text-section-title font-semibold">{t("more.groups.daily")}</h2>
          {dailyLinks.map((l) => (
            <Link key={l.id} href={l.href} data-testid={l.id} className="flex min-h-11 flex-col gap-1 rounded-card border border-border bg-surface p-4 hover:bg-bg">
              <span className="text-row-title font-semibold">{l.title}</span>
              <span className="text-[14px] text-muted">{l.text}</span>
            </Link>
          ))}
        </section>
      ) : null}

      {moneyLinks.length > 0 ? (
        <section className="flex flex-col gap-2" data-testid="more-group-money">
          <h2 className="text-section-title font-semibold">{t("more.groups.money")}</h2>
          {moneyLinks.map((l) => (
            <Link key={l.id} href={l.href} data-testid={l.id} className="flex min-h-11 flex-col gap-1 rounded-card border border-border bg-surface p-4 hover:bg-bg">
              <span className="text-row-title font-semibold">{l.title}</span>
              <span className="text-[14px] text-muted">{l.text}</span>
            </Link>
          ))}
        </section>
      ) : null}

      {canOpenSettings(user) ? <SettingsMenu locale={locale} admin={isOrgAdmin(user)} /> : null}

      <h2 className="mt-2 text-section-title font-semibold">{t("more.groups.account")}</h2>
      <Card>
        <h3 className="text-row-title font-semibold">{t("more.profile")}</h3>
        <dl className="mt-3 flex flex-col gap-2 text-[14px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t("more.signedInAs")}</dt>
            <dd className="font-medium" data-testid="user-name">{user.name}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t("more.role")}</dt>
            <dd className="font-medium">{user.activeRole ? t(`roles.${user.activeRole}`) : "—"}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <form action={savePreferences} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-row-title font-semibold">{t("more.language")}</legend>
            <Segment
              name="locale"
              value={locale}
              options={[
                { value: "ar", label: t("common.arabic"), lang: "ar" },
                { value: "en", label: t("common.english"), lang: "en" },
              ]}
            />
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-row-title font-semibold">{t("more.digits")}</legend>
            <Segment
              name="digits"
              value={user.digits}
              options={[
                { value: "latin", label: t("more.digitsLatin") },
                { value: "arabic", label: t("more.digitsArabic") },
              ]}
            />
          </fieldset>
          <Button type="submit" className="self-start" data-testid="save-preferences">
            {t("common.save")}
          </Button>
        </form>
      </Card>

      {user.roles.length > 1 ? (
        <Card>
          <h3 className="text-row-title font-semibold">{t("more.switchRole")}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {user.roles.map((role) => (
              <form key={role} action={switchRole}>
                <input type="hidden" name="role" value={role} />
                <input type="hidden" name="locale" value={locale} />
                <Button type="submit" variant={role === user.activeRole ? "primary" : "secondary"} aria-pressed={role === user.activeRole}>
                  {t(`roles.${role}`)}
                </Button>
              </form>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <h3 className="text-row-title font-semibold">{t("alerts.push.title")}</h3>
        <PushToggle />
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="text-row-title font-semibold">{t("more.security")}</h3>
        <p className="text-[14px]" data-testid="mfa-status">{user.mfaEnabled ? t("more.mfaOn") : t("more.mfaOff")}</p>
        {!user.mfaEnabled ? (
          <Link href="/setup-mfa" className={`${buttonClasses("secondary")} self-start`}>
            {t("more.setUpMfa")}
          </Link>
        ) : null}
      </Card>

      {!requiresMfa(user.roles) ? (
        <Card className="flex flex-col gap-3" data-testid="pin-card">
          <h3 className="text-row-title font-semibold">{t("more.pinTitle")}</h3>
          <p className="text-[14px] text-muted">{t("more.pinHelp")}</p>
          {pin ? (
            <Alert tone={pin === "ok" || pin === "removed" ? "good" : "critical"}>{t(`more.pinResult.${pin === "ok" || pin === "removed" || pin === "weak" || pin === "mismatch" ? pin : "needsMfa"}`)}</Alert>
          ) : null}
          <form action={setUpPin} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="locale" value={locale} />
            <div className="flex flex-col gap-1">
              <label htmlFor="pin" className="text-[13px] font-medium text-subtle">
                {t("more.pin")}
              </label>
              <input id="pin" name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6} required autoComplete="new-password" dir="ltr" className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="pinAgain" className="text-[13px] font-medium text-subtle">
                {t("more.pinAgain")}
              </label>
              <input id="pinAgain" name="pinAgain" type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6} required autoComplete="new-password" dir="ltr" className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]" />
            </div>
            <Button type="submit" data-testid="save-pin">
              {t("more.pinSave")}
            </Button>
          </form>
          <form action={forgetPin}>
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="text-[14px] text-brand underline">
              {t("more.pinForget")}
            </button>
          </form>
        </Card>
      ) : null}

      <SignOutButton />
    </div>
  );
}
