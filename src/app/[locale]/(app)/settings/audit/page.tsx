import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { AUDITED_TABLES, auditNames, readAudit } from "@/db/audit";
import { requireSettings } from "@/lib/require-user";
import { auditChanges } from "@/lib/audit-diff";
import { auditFormatter } from "@/lib/audit-format";
import { formatTimestamp } from "@/lib/format";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { PageHeader, SelectField } from "@/components/settings/Fields";

const cursor = z.string().regex(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?_[0-9a-f-]{36}$/);

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ table?: string; before?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = await requireSettings(locale, "admin");
  const t = await getTranslations("settings");
  const table = z.enum(AUDITED_TABLES).optional().catch(undefined).parse(sp.table || undefined);
  const before = cursor.optional().catch(undefined).parse(sp.before);
  const loc = locale === "en" ? "en" : "ar";
  const { rows, next, names } = await withUserDb(user.id, async (tx) => ({ ...(await readAudit(tx, { table, before })), names: await auditNames(tx, loc) }));
  const tRoot = await getTranslations();
  const readable = auditFormatter(tRoot as never, (k) => tRoot.has(k as never), names);
  const exportHref = `/api/export/audit?locale=${loc}${table ? `&table=${table}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("audit.title")} help={t("audit.help")}>
        <a href={exportHref} className={buttonClasses("secondary")} data-testid="export-audit" download>
          {t("common.exportExcel")}
        </a>
      </PageHeader>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-48">
          <SelectField
            id="audit-table"
            name="table"
            label={t("audit.filter")}
            defaultValue={table ?? ""}
            options={[{ value: "", label: t("audit.allTables") }, ...AUDITED_TABLES.map((v) => ({ value: v, label: t(`audit.tables.${v}`) }))]}
          />
        </div>
        <Button type="submit" variant="secondary">
          {t("audit.filter")}
        </Button>
      </form>

      {rows.length === 0 ? (
        <Card>
          <p className="text-muted">{t("common.none")}</p>
        </Card>
      ) : (
        <ol className="flex flex-col gap-3" data-testid="audit-list">
          {rows.map((r) => {
            const changes = auditChanges(r.action, r.before, r.after).map(readable);
            return (
              <li key={r.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold">
                      {t(`audit.actions.${r.action as "insert"}`)} · {t(`audit.tables.${r.tableName as "branch"}`)}
                    </p>
                    <p className="figure text-meta text-muted">{formatTimestamp(r.at, loc, user.digits)}</p>
                  </div>
                  <p className="text-[14px] text-subtle">
                    {t("audit.who")}: {r.actorName ?? t("audit.system")}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                  {changes.length > 0 ? (
                    <ul className="flex flex-col gap-1 text-[14px]">
                      {changes.map((c) => (
                        <li key={c.field} className="break-words">
                          <span className="text-muted">{c.field}</span>
                          {": "}
                          {c.from !== undefined ? (
                            <>
                              <bdi className="line-through decoration-muted">{c.from}</bdi> → <bdi>{c.to}</bdi>
                            </>
                          ) : (
                            <bdi>{c.to}</bdi>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
      <nav className="flex gap-4">
        {before ? (
          <Link href={{ pathname: "/settings/audit", query: table ? { table } : {} }} className="inline-flex min-h-11 items-center font-medium text-brand underline">
            {t("audit.newest")}
          </Link>
        ) : null}
        {next ? (
          <Link
            href={{ pathname: "/settings/audit", query: { ...(table ? { table } : {}), before: next } }}
            className="inline-flex min-h-11 items-center font-medium text-brand underline"
            data-testid="audit-older"
          >
            {t("audit.older")}
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
