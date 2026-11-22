import { getTranslations } from "next-intl/server";
import { requireSection } from "@/lib/require-user";
import { addActionsFor, type AddAction } from "@/lib/roles";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/Card";
import { SectionPlaceholder } from "@/components/SectionPlaceholder";

/** Actions that are built so far, and where they open. The rest arrive in later phases. */
const READY: Partial<Record<AddAction, string>> = { child: "/children/new", "roll-call": "/roll-call", payment: "/payment", expense: "/expenses/new" };

/** "+ Add" sheet (spec §11.1), filtered by the active role. Each action is built in its own phase. */
export default async function AddPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await requireSection(locale, "add");
  const t = await getTranslations("add");
  const actions = addActionsFor(user.activeRole);
  return (
    <div className="flex flex-col gap-4">
      <SectionPlaceholder
        section="add"
        locale={locale === "en" ? "en" : "ar"}
        digits={user.digits}
      />
      <Card>
        <h2 className="text-section-title font-semibold">{t("title")}</h2>
        <ul className="mt-3 grid grid-cols-2 gap-2" data-testid="add-actions">
          {actions.map((a) => (
            <li key={a}>
              {READY[a] ? (
                <Link
                  href={READY[a]}
                  data-testid={`add-${a}`}
                  className="flex min-h-12 w-full items-center justify-center rounded-button bg-brand px-3 text-[14px] font-semibold text-white hover:bg-brand-hover"
                >
                  {t(a)}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex min-h-12 w-full items-center justify-center rounded-button border border-outline bg-surface px-3 text-[14px] font-medium text-ink disabled:opacity-60"
                >
                  {t(a)}
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
