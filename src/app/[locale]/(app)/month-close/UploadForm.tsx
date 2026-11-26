"use client";
import { startTransition, useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { commitMonthClose, previewMonthClose, type MonthImportState } from "./actions";

/** Upload the filled template → see each line against the app, with row errors → save (spec §8.10, rule 13). */
export function UploadForm({ branchId, month }: { branchId: string; month: string }) {
  const t = useTranslations("closing.month.upload");
  const tc = useTranslations("closing");
  const locale = useLocale();
  const [preview, previewAction, checking] = useActionState<MonthImportState, FormData>(previewMonthClose, { status: "idle" });
  const [commit, commitAction, saving] = useActionState<MonthImportState, FormData>(commitMonthClose, { status: "idle" });
  const errorText = (code: string) =>
    t.has(`errors.${code}`) ? t(`errors.${code}` as "errors.badFile") : tc.has(`errors.${code}`) ? tc(`errors.${code}` as "errors.unknown") : tc("errors.unknown");

  if (commit.status === "done") {
    return (
      <Alert tone="good">
        <span data-testid="month-import-done">{t("done", { count: commit.count })}</span>{" "}
        <a href={`/${locale}/month-close?branch=${branchId}&month=${month}`} className="underline">{t("refresh")}</a>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => previewAction(fd));
        }}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="branchId" value={branchId} />
        <input type="hidden" name="month" value={month} />
        <label htmlFor="mc-file" className="text-[13px] font-medium text-subtle">{t("file")}</label>
        <input id="mc-file" name="file" type="file" required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="min-h-11 text-[15px]" data-testid="month-file" />
        <Button type="submit" variant="secondary" disabled={checking} className="self-start" data-testid="month-check">
          {checking ? t("checking") : t("check")}
        </Button>
      </form>

      {preview.status === "error" ? <Alert>{errorText(preview.code)}</Alert> : null}
      {commit.status === "error" ? <Alert>{errorText(commit.code)}</Alert> : null}

      {preview.status === "preview" ? (
        <Card className="flex flex-col gap-3" data-testid="month-preview">
          {preview.errors.length ? (
            <>
              <Alert>{t("errorsTitle", { count: preview.errors.length })}</Alert>
              <ul className="flex flex-col gap-1 text-[14px]" data-testid="month-errors">
                {preview.errors.map((e, i) => (
                  <li key={i}>
                    {e.row ? <span className="figure font-semibold">{t("rowLabel", { row: e.row })}: </span> : null}
                    {t(`rowErrors.${e.code}`, { line: e.line ?? "" })}
                  </li>
                ))}
              </ul>
              <p className="text-meta text-muted">{t("fixAndRetry")}</p>
            </>
          ) : (
            <>
              <p className="text-section-title font-semibold">{t("ready", { count: preview.lines.length })}</p>
              <ul className="flex flex-col divide-y divide-border text-[14px]">
                {preview.lines.map((l) => (
                  <li key={l.code} className="flex flex-col gap-0.5 py-2">
                    <span className="flex justify-between gap-3">
                      <span>{l.label}</span>
                      <span className={`figure ${l.differs ? "font-semibold text-attention" : ""}`}>{l.amount}</span>
                    </span>
                    {l.differs ? <span className="text-meta text-muted figure">{t("appWas", { app: l.app ?? "" })}</span> : null}
                    {l.note ? <span className="text-meta text-muted">{l.note}</span> : null}
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
                <input type="hidden" name="month" value={month} />
                <input type="hidden" name="fileName" value={preview.fileName} />
                <input type="hidden" name="linesJson" value={preview.linesJson} />
                <Button type="submit" disabled={saving} data-testid="month-commit">
                  {saving ? t("saving") : t("save", { count: preview.lines.length })}
                </Button>
              </form>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
