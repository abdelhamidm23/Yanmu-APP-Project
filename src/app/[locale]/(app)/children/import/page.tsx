import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { appUser, importBatch } from "@/db/schema";
import { requireChildren } from "@/lib/require-user";
import { hasRoleIn } from "@/lib/permissions";
import { formatTimestamp } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { BranchTabs, pickBranch } from "@/components/children/BranchTabs";
import { ChildResult } from "@/components/children/ChildResult";
import { ImportForm } from "./ImportForm";
import { rollbackImport } from "./actions";

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ branch?: string; ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireChildren(locale, "import");
  const t = await getTranslations("children");
  const loc = locale === "en" ? "en" : "ar";

  const data = await withUserDb(user.id, async (tx) => {
    const branches = (await visibleBranches(tx)).filter((b) => hasRoleIn(user, ["company_manager"], b.id));
    const b = pickBranch(branches, sp.branch);
    if (!b) return null;
    const batches = await tx
      .select({ batch: importBatch, by: appUser.name })
      .from(importBatch)
      .leftJoin(appUser, eq(appUser.id, importBatch.createdBy))
      .where(eq(importBatch.branchId, b.id))
      .orderBy(desc(importBatch.createdAt))
      .limit(20);
    return { branches, b, batches };
  });
  if (!data) return <Card>{t("noBranch")}</Card>;
  const { branches, b, batches } = data;

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/children?branch=${b.id}`} className="text-[14px] text-brand underline">{t("backToList")}</Link>
      <PageHeader title={t("importPage.title")} help={t("importPage.help")} />
      <BranchTabs branches={branches} current={b.id} path="/children/import" locale={locale} label={t("branch")} />
      <ChildResult searchParams={sp} />
      <Card className="flex flex-col gap-2">
        <ol className="list-decimal ps-5 text-[14px]">
          <li>{t("importPage.step1")}</li>
          <li>{t("importPage.step2")}</li>
          <li>{t("importPage.step3")}</li>
          <li>{t("importPage.step4")}</li>
        </ol>
        <a href={`/api/import-template/children?branch=${b.id}&locale=${loc}`} className={`${buttonClasses("secondary")} self-start`} data-testid="import-template">
          {t("importPage.template")}
        </a>
      </Card>
      <ImportForm branchId={b.id} />
      <Card className="flex flex-col gap-3">
        <h2 className="text-section-title font-semibold">{t("importPage.batches")}</h2>
        {batches.length === 0 ? <p className="text-[14px] text-muted">{t("importPage.noBatches")}</p> : null}
        <ul className="flex flex-col divide-y divide-border" data-testid="import-batches">
          {batches.map(({ batch, by }) => (
            <li key={batch.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
              <span className="flex flex-col">
                <span className="font-medium">{batch.fileName}</span>
                <span className="figure text-meta text-muted">
                  {t("importPage.batchLine", { count: batch.rowCount, name: by ?? "—", date: formatTimestamp(batch.createdAt, loc, user.digits) })}
                  {batch.rolledBackAt ? ` · ${t("importPage.rolledBack", { date: formatTimestamp(batch.rolledBackAt, loc, user.digits) })}` : ""}
                </span>
              </span>
              {batch.status === "committed" ? (
                <form action={rollbackImport}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="branchId" value={b.id} />
                  <input type="hidden" name="batchId" value={batch.id} />
                  <Button type="submit" variant="secondary" data-testid="import-rollback">{t("importPage.rollback")}</Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
