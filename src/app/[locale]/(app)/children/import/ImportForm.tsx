"use client";
import { startTransition, useActionState, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IMPORT_COLUMNS } from "@/lib/child-import";
import { commitImport, previewImport, type ImportState } from "./actions";

/** Upload → preview with row errors → import as one batch (spec §8.11). */
export function ImportForm({ branchId }: { branchId: string }) {
  const t = useTranslations("children.importPage");
  const tc = useTranslations("children");
  const locale = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, previewAction, checking] = useActionState<ImportState, FormData>(previewImport, { status: "idle" });
  const [commit, commitAction, importing] = useActionState<ImportState, FormData>(commitImport, { status: "idle" });
  const column = (key: string | null) => {
    const c = IMPORT_COLUMNS.find((x) => x.key === key);
    return c ? (locale === "ar" ? c.ar : c.en) : "";
  };

  if (commit.status === "done") {
    return (
      <Card className="flex flex-col gap-3" data-testid="import-done">
        <Alert tone="good">{t("done", { count: commit.count })}</Alert>
        <Link href={`/children?branch=${branchId}`} className={`${buttonClasses("secondary")} self-start`}>
          {tc("backToList")}
        </Link>
      </Card>
    );
  }

  const errorText = (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}` as "errors.badFile") : tc.has(`errors.${code}`) ? tc(`errors.${code}` as "errors.unknown") : tc("errors.unknown"));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(() => previewAction(fd));
          }}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="branchId" value={branchId} />
          <label htmlFor="import-file" className="text-[13px] font-medium text-subtle">
            {t("file")}
          </label>
          <input id="import-file" name="file" type="file" required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="min-h-11 text-[15px]" data-testid="import-file" />
          <Button type="submit" variant="secondary" disabled={checking} className="self-start" data-testid="import-check">
            {checking ? t("checking") : t("check")}
          </Button>
        </form>
      </Card>

      {preview.status === "error" ? <Alert>{errorText(preview.code)}</Alert> : null}
      {commit.status === "error" ? <Alert>{errorText(commit.code)}</Alert> : null}

      {preview.status === "preview" ? (
        <Card className="flex flex-col gap-3" data-testid="import-preview">
          {preview.errors.length ? (
            <>
              <Alert>{t("errorsTitle", { count: preview.errors.length })}</Alert>
              <ul className="flex flex-col gap-1 text-[14px]" data-testid="import-errors">
                {preview.errors.map((e, i) => (
                  <li key={i}>
                    <span className="figure font-semibold">{t("rowLabel", { row: e.row })}</span>
                    {": "}
                    {t(`errors.${e.code}`, { column: column(e.column) })}
                  </li>
                ))}
              </ul>
              <p className="text-meta text-muted">{t("fixAndRetry")}</p>
            </>
          ) : (
            <>
              <p className="text-section-title font-semibold">{t("ready", { count: preview.count })}</p>
              <ul className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto text-[14px]">
                {preview.sample.map((c) => (
                  <li key={c.row} className="flex justify-between gap-2 py-1.5">
                    <span>{c.name}</span>
                    <span className="text-muted">
                      {c.room}
                      {c.bandOverride ? ` · ${tc("flags.bandOverride")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  startTransition(() => commitAction(fd));
                }}
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="branchId" value={branchId} />
                <input type="hidden" name="fileName" value={preview.fileName} />
                <input type="hidden" name="rowsJson" value={preview.rowsJson} />
                <Button type="submit" disabled={importing} data-testid="import-commit">
                  {importing ? t("importing") : t("importButton", { count: preview.count })}
                </Button>
              </form>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
