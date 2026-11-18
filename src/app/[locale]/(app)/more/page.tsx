import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireSection } from "@/lib/require-user";
import { canOpenSettings, canOpenToday, canTakeAttendance, canViewChildren, canViewStaff, canViewStaffAttendance } from "@/lib/permissions";
import { canOpenSection, requiresMfa } from "@/lib/roles";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClasses } from "@/components/ui/Button";
import { forgetPin, savePreferences, setUpPin, switchRole } from "./actions";
import { SignOutButton } from "./SignOutButton";

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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold">{t("nav.more")}</h1>
      {saved ? <Alert tone="good">{t("more.saved")}</Alert> : null}

      <Card>
        <h2 className="text-section-title font-semibold">{t("more.profile")}</h2>
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

      {canViewChildren(user) && !(user.activeRole && canOpenSection(user.activeRole, "children")) ? (
        <Link
          href="/children"
          data-testid="open-children"
          className="flex min-h-11 flex-col gap-1 rounded-card border border-border bg-surface p-4 hover:bg-bg"
        >
          <span className="text-section-title font-semibold">{t("more.children")}</span>
          <span className="text-[14px] text-muted">{t("more.childrenLink")}</span>
        </Link>
      ) : null}

      {[
        { show: canOpenToday(user) && !(user.activeRole && canOpenSection(user.activeRole, "today")), href: "/today", title: t("today.title"), text: t("more.todayLink"), id: "open-today" },
        { show: canTakeAttendance(user) && !(user.activeRole && canOpenSection(user.activeRole, "roll-call")), href: "/roll-call", title: t("attendance.rollCallTitle"), text: t("more.rollCallLink"), id: "open-roll-call" },
        { show: canViewStaff(user) && !(user.activeRole && canOpenSection(user.activeRole, "staff")), href: "/staff", title: t("staff.title"), text: t("more.staffLink"), id: "open-staff" },
        {
          show: canViewStaffAttendance(user) && !(user.activeRole && canOpenSection(user.activeRole, "staff-attendance")),
          href: "/staff-attendance",
          title: t("staffAttendance.title"),
          text: t("more.staffAttendanceLink"),
          id: "open-staff-attendance",
        },
      ]
        .filter((l) => l.show)
        .map((l) => (
          <Link key={l.id} href={l.href} data-testid={l.id} className="flex min-h-11 flex-col gap-1 rounded-card border border-border bg-surface p-4 hover:bg-bg">
            <span className="text-section-title font-semibold">{l.title}</span>
            <span className="text-[14px] text-muted">{l.text}</span>
          </Link>
        ))}

      {canOpenSettings(user) ? (
        <Link
          href="/settings"
          data-testid="open-settings"
          className="flex min-h-11 flex-col gap-1 rounded-card border border-border bg-surface p-4 hover:bg-bg"
        >
          <span className="text-section-title font-semibold">{t("settings.title")}</span>
          <span className="text-[14px] text-muted">{t("settings.moreLink")}</span>
        </Link>
      ) : null}

      <Card>
        <form action={savePreferences} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-section-title font-semibold">{t("more.language")}</legend>
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
            <legend className="mb-2 text-section-title font-semibold">{t("more.digits")}</legend>
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
          <h2 className="text-section-title font-semibold">{t("more.switchRole")}</h2>
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
        <h2 className="text-section-title font-semibold">{t("more.security")}</h2>
        <p className="text-[14px]" data-testid="mfa-status">{user.mfaEnabled ? t("more.mfaOn") : t("more.mfaOff")}</p>
        {!user.mfaEnabled ? (
          <Link href="/setup-mfa" className={`${buttonClasses("secondary")} self-start`}>
            {t("more.setUpMfa")}
          </Link>
        ) : null}
      </Card>

      {!requiresMfa(user.roles) ? (
        <Card className="flex flex-col gap-3" data-testid="pin-card">
          <h2 className="text-section-title font-semibold">{t("more.pinTitle")}</h2>
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
