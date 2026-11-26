import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { alertText } from "@/lib/alert-text";
import { ackAlert } from "@/app/[locale]/(app)/inbox/alert-actions";

type Pending = { id: string; key: string; subjectId: string | null; branchAr: string; branchEn: string };

/**
 * Red banner on every screen while a critical alert has not been acknowledged (spec §10). One tap on
 * "I'm on it" stops the repeats for everyone. Words only say the kind and the branch (rule 9).
 */
export async function CriticalBanner({ pending, locale }: { pending: Pending[]; locale: string }) {
  if (pending.length === 0) return null;
  const t = await getTranslations("alerts");
  const loc = locale === "en" ? "en" : "ar";
  const first = pending[0];
  const text = alertText(first.key, loc, { ar: first.branchAr, en: first.branchEn });
  const href = first.subjectId && first.key.includes("incident") ? `/incidents/${first.subjectId}` : "/inbox";
  return (
    <div role="alert" className="border-b border-critical bg-critical text-white" data-testid="critical-banner">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3 md:ms-60 md:max-w-none md:px-8">
        <span className="flex-1 font-semibold">
          {text.title}
          {pending.length > 1 ? <span className="block text-[14px] font-normal">{t("bannerMore", { count: pending.length - 1, n: String(pending.length - 1) })}</span> : null}
        </span>
        <Link href={href} className="inline-flex min-h-11 items-center rounded-button border border-white px-3 font-medium text-white">{t("open")}</Link>
        <form action={ackAlert}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="alertId" value={first.id} />
          <input type="hidden" name="back" value={href} />
          <button type="submit" className="inline-flex min-h-11 items-center rounded-button bg-white px-4 font-semibold text-critical" data-testid="banner-ack">
            {t("ack")}
          </button>
        </form>
      </div>
    </div>
  );
}
