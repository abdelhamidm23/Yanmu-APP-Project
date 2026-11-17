import { getTranslations } from "next-intl/server";
import { LanguageSwitch } from "./LanguageSwitch";
import { DemoPill } from "./DemoPill";

/** Frame for sign-in and MFA screens. */
export async function AuthShell({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  const t = await getTranslations("app");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-section-title font-semibold text-brand">{t("name")}</span>
          <span className="text-meta text-muted">{t("tagline")}</span>
        </div>
        <LanguageSwitch />
      </header>
      <DemoPill />
      <section className="rounded-card border border-border bg-surface p-5">
        <h1 className="text-page-title font-semibold">{title}</h1>
        {intro ? <p className="mt-2 text-muted">{intro}</p> : null}
        <div className="mt-5">{children}</div>
      </section>
    </main>
  );
}
