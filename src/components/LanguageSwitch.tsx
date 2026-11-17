"use client";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

/** Segmented control: العربية | English. Used on sign-in screens; signed-in users change it in More. */
export function LanguageSwitch() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("common");
  const options = [
    { code: "ar", label: t("arabic") },
    { code: "en", label: t("english") },
  ] as const;
  return (
    <nav aria-label={t("language")} className="inline-flex rounded-button bg-segment-bg p-1">
      {options.map((o) => {
        const active = o.code === locale;
        return (
          <Link
            key={o.code}
            href={pathname}
            locale={o.code}
            lang={o.code}
            aria-current={active ? "true" : undefined}
            className={`inline-flex min-h-11 min-w-20 items-center justify-center rounded-segment px-3 text-[14px] font-medium ${
              active ? "bg-brand text-white" : "text-ink"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
