"use client";
import { startTransition, useActionState, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PUNCH_FIELDS } from "@/lib/staff-import";
import { punchImport, type PunchImportState } from "./actions";

const select = "min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]";

/** Upload → map columns → check rows → save as one batch (spec §8.3, rule 13). */
export function PunchImportForm({ branchId, sampleHref }: { branchId: string; sampleHref?: string }) {
  const t = useTranslations("staffAttendance");
  const locale = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<PunchImportState, FormData>(punchImport, { status: "idle" });

  function submit(intent: "preview" | "commit", withMapping: boolean) {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const fd = new FormData(form);
    fd.set("intent", intent);
    if (!withMapping) {
      fd.delete("mapped");
      for (const k of [...fd.keys()]) if (k.startsWith("link_")) fd.delete(k);
    }
    startTransition(() => action(fd));
  }

  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(new Date(iso));
  const err = (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}` as "errors.badFile") : t("errors.unknown"));

  return (
    <Card className="flex flex-col gap-3" data-testid="punch-import">
      <h2 className="text-section-title font-semibold">{t("uploadTitle")}</h2>
      <p className="text-[14px] text-muted">{t("uploadHelp")}</p>
      {sampleHref ? (
        <a href={sampleHref} className="self-start text-[14px] font-medium text-brand underline" data-testid="sample-punch-file">
          {t("sampleFile")}
        </a>
      ) : null}
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit("preview", false);
        }}
        onChange={(e) => {
          // A new file starts again from the saved mapping.
          if ((e.target as HTMLElement).id === "punch-file" && state.status !== "idle") submit("preview", false);
        }}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="branchId" value={branchId} />
        <label htmlFor="punch-file" className="text-[13px] font-medium text-subtle">
          {t("file")}
        </label>
        <input id="punch-file" name="file" type="file" required accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="min-h-11 text-[15px]" data-testid="punch-file" />
        {state.status === "idle" || state.status === "error" ? (
          <Button type="submit" variant="secondary" disabled={pending} className="self-start" data-testid="punch-check">
            {pending ? t("checking") : t("check")}
          </Button>
        ) : null}

        {state.status === "error" ? <Alert>{err(state.code)}</Alert> : null}

        {state.status === "preview" ? (
          <div className="flex flex-col gap-4" data-testid="punch-preview">
            <input type="hidden" name="mapped" value="1" />
            <fieldset className="flex flex-col gap-2 rounded-button border border-border p-3">
              <legend className="px-1 text-[14px] font-semibold">{t("mappingTitle")}</legend>
              <p className="text-meta text-muted">{t("mappingHelp")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {PUNCH_FIELDS.map((f) => (
                  <div key={`${f}-${state.mapping[f] ?? ""}`} className="flex flex-col gap-1">
                    <label htmlFor={`map-${f}`} className="text-[13px] font-medium text-subtle">
                      {t(`fields.${f}`)}
                    </label>
                    <select id={`map-${f}`} name={`map_${f}`} defaultValue={state.mapping[f] ?? ""} className={select} data-testid={`map-${f}`}>
                      <option value="">{t("notInFile")}</option>
                      {state.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {state.problems.length ? (
                <Alert>{state.problems.map((p) => t(`mappingProblems.${p}` as "mappingProblems.when")).join(" ")}</Alert>
              ) : null}
              <Button variant="secondary" onClick={() => submit("preview", true)} disabled={pending} className="self-start" data-testid="punch-recheck">
                {t("checkAgain")}
              </Button>
            </fieldset>

            {state.problems.length === 0 ? (
              <>
                <p className="figure text-[15px]" data-testid="punch-summary">
                  {t("summary", { count: state.count, from: state.from ?? "—", to: state.to ?? "—" })}
                  {state.duplicates ? ` ${t("duplicates", { count: state.duplicates })}` : ""}
                </p>
                {state.sample.length ? (
                  <ul className="flex flex-col gap-1 text-[14px] text-subtle">
                    {state.sample.map((s) => (
                      <li key={s.row} className="figure">
                        {t("sampleRow", { row: s.row, no: s.employeeNo, name: s.name ?? "—", when: when(s.at) })}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {state.errors.length ? (
                  <div className="flex flex-col gap-1" data-testid="punch-errors">
                    <p className="font-semibold text-critical">{t("errorsTitle", { count: state.errors.length })}</p>
                    <ul className="flex flex-col gap-1 text-[14px]">
                      {state.errors.slice(0, 20).map((e) => (
                        <li key={e.row}>{t("errorRow", { row: e.row, message: t(`rowErrors.${e.code}`) })}</li>
                      ))}
                    </ul>
                    <p className="text-meta text-muted">{t("errorsSkipped")}</p>
                  </div>
                ) : null}
                {state.unknown.length ? (
                  <fieldset className="flex flex-col gap-2 rounded-button border border-attention p-3" data-testid="punch-unknown">
                    <legend className="px-1 text-[14px] font-semibold text-attention">{t("unknownTitle", { count: state.unknown.length })}</legend>
                    <p className="text-meta text-muted">{t("unknownHelp")}</p>
                    {state.unknown.map((u) => (
                      <div key={u.employeeNo} className="flex flex-col gap-1">
                        <label htmlFor={`link-${u.employeeNo}`} className="text-[14px]">
                          {t("unknownRow", { no: u.employeeNo, name: u.name ?? "—", count: u.count })}
                        </label>
                        <select id={`link-${u.employeeNo}`} name={`link_${u.employeeNo}`} defaultValue="" className={select}>
                          <option value="">{t("leaveUnlinked")}</option>
                          {state.staffOptions.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </fieldset>
                ) : null}
                <Button onClick={() => submit("commit", true)} disabled={pending || state.count === 0} className="self-start" data-testid="punch-commit">
                  {pending ? t("saving") : t("commit", { count: state.count })}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        {state.status === "done" ? (
          <Alert tone="good">
            <span data-testid="punch-done">{t("done", { count: state.count, days: state.days })}</span>
            {state.skipped ? ` ${t("alreadySaved", { count: state.skipped })}` : ""}
          </Alert>
        ) : null}
      </form>
    </Card>
  );
}
