import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonClasses } from "@/components/ui/Button";

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-page-title font-semibold">{t("notFoundTitle")}</h1>
      <p className="text-muted">{t("notFoundBody")}</p>
      <Link href="/" className={buttonClasses("primary")}>
        {t("goHome")}
      </Link>
    </main>
  );
}
