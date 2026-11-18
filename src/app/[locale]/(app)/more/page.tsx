import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireSection } from "@/lib/require-user";
import { canOpenSettings, canViewChildren } from "@/lib/permissions";
import { canOpenSection } from "@/lib/roles";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClasses } from "@/components/ui/Button";
import { savePreferences, switchRole } from "./actions";
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
  searchParams: Promise<{ saved?: string }>;
}) {
  const { locale } = await params;
  const { saved } = await searchParams;
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

      <SignOutButton />
    </div>
  );
}
