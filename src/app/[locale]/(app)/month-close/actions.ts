"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { withUserDb, dbErrorCode } from "@/db/rls";
import { withClosingErrors } from "@/db/closing-errors";
import { period } from "@/db/closing";
import { templateLines } from "@/db/month-pack";
import { balanceSnapshot, importBatch, periodClose, periodImportLine } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { canCloseMonth, canReopenMonth } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { getCurrentUser } from "@/lib/session";
import { readRows } from "@/lib/excel";
import { egpText, parseTemplate, type TemplateError } from "@/lib/month-close";

const locale = z.enum(["ar", "en"]).catch("ar");
const monthParam = z.string().regex(/^\d{4}-\d{2}$/);
const MAX_FILE = 5 * 1024 * 1024;

export type PreviewLine = { code: string; label: string; kind: string; app: string | null; amount: string; note: string | null; differs: boolean };
export type MonthImportState =
  | { status: "idle" }
  | { status: "error"; code: string }
  | { status: "preview"; fileName: string; linesJson: string; lines: PreviewLine[]; errors: TemplateError[] }
  | { status: "done"; count: number };

/** Step 1: read the filled template and show each line against the app, with row errors. Nothing is saved. */
export async function previewMonthClose(_prev: MonthImportState, fd: FormData): Promise<MonthImportState> {
  const user = await getCurrentUser();
  const branchId = z.uuid().safeParse(fd.get("branchId"));
  const month = monthParam.safeParse(fd.get("month"));
  if (!user || user.mustSetUpMfa || !branchId.success || !month.success || !canCloseMonth(user, branchId.data)) return { status: "error", code: "forbidden" };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", code: "noFile" };
  if (file.size > MAX_FILE) return { status: "error", code: "badFile" };
  let rows: Awaited<ReturnType<typeof readRows>>;
  try {
    rows = await readRows(await file.arrayBuffer());
  } catch {
    return { status: "error", code: "badFile" };
  }
  if (rows.length === 0) return { status: "error", code: "noRows" };
  const loc = locale.parse(fd.get("locale"));
  const t = await getTranslations({ locale: loc });
  return withUserDb(user.id, async (tx) => {
    const p = await period(tx, branchId.data, `${month.data}-01`);
    if (p.status === "closed") return { status: "error", code: "month_closed" } as const;
    const expected = await templateLines(tx, branchId.data, `${month.data}-01`, loc, t);
    const parsed = parseTemplate(rows, expected);
    const label = new Map(expected.map((l) => [l.code, l.label]));
    return {
      status: "preview",
      fileName: file.name.slice(0, 160),
      linesJson: JSON.stringify(parsed.lines.map((l) => ({ ...l, app: l.app?.toString() ?? null, amount: l.amount.toString() }))),
      lines: parsed.lines.map((l) => ({
        code: l.code, label: label.get(l.code) ?? l.code, kind: l.kind, app: l.app === null ? null : egpText(l.app), amount: egpText(l.amount), note: l.note,
        differs: l.kind === "check" && l.app !== l.amount,
      })),
      errors: parsed.errors.slice(0, 200),
    } as const;
  });
}

const savedLine = z.object({
  code: z.string().max(80),
  kind: z.enum(["check", "central", "balance"]),
  categoryId: z.uuid().nullable(),
  app: z.string().regex(/^-?\d+$/).nullable(),
  amount: z.string().regex(/^-?\d+$/),
  note: z.string().max(500).nullable(),
});

/**
 * Step 2: save the lines as one batch. An earlier upload of the same month is replaced (and kept as
 * rolled back), so the month always has one set of figures. The app's figures are read again here.
 */
export async function commitMonthClose(_prev: MonthImportState, fd: FormData): Promise<MonthImportState> {
  const user = await getCurrentUser();
  const branchId = z.uuid().safeParse(fd.get("branchId"));
  const month = monthParam.safeParse(fd.get("month"));
  if (!user || user.mustSetUpMfa || !branchId.success || !month.success || !canCloseMonth(user, branchId.data)) return { status: "error", code: "forbidden" };
  let lines: z.infer<typeof savedLine>[];
  try {
    lines = z.array(savedLine).max(200).parse(JSON.parse(String(fd.get("linesJson") ?? "[]")));
  } catch {
    return { status: "error", code: "invalid" };
  }
  if (lines.length === 0) return { status: "error", code: "noRows" };
  const loc = locale.parse(fd.get("locale"));
  const t = await getTranslations({ locale: loc });
  const first = `${month.data}-01`;
  try {
    const r = await withClosingErrors(() =>
      withUserDb(
        user.id,
        async (tx) => {
          const p = await period(tx, branchId.data, first);
          if (p.status === "closed") return { error: "month_closed" };
          const expected = new Map((await templateLines(tx, branchId.data, first, loc, t)).map((l) => [l.code, l]));
          // The app's figure may have moved since the preview: a check line that now differs needs a note.
          for (const l of lines) {
            const e = expected.get(l.code);
            if (!e || e.kind !== l.kind) return { error: "stale" };
            if (l.kind === "check" && e.app !== BigInt(l.amount) && (l.note ?? "").trim().length < 3) return { error: "stale" };
          }
          const old = await tx.select({ batchId: periodImportLine.batchId }).from(periodImportLine).where(eq(periodImportLine.periodCloseId, p.id));
          const oldIds = [...new Set(old.map((o) => o.batchId))];
          if (oldIds.length) {
            await tx.delete(periodImportLine).where(eq(periodImportLine.periodCloseId, p.id));
            await tx.delete(balanceSnapshot).where(inArray(balanceSnapshot.batchId, oldIds));
            await tx.update(importBatch).set({ status: "rolled_back", rolledBackAt: new Date() }).where(inArray(importBatch.id, oldIds));
          }
          const [batch] = await tx
            .insert(importBatch)
            .values({ branchId: branchId.data, kind: "month_close", fileName: `${month.data} ${String(fd.get("fileName") ?? "").slice(0, 160)}`, rowCount: lines.length })
            .returning({ id: importBatch.id });
          await tx.insert(periodImportLine).values(
            lines.map((l) => ({
              periodCloseId: p.id, branchId: branchId.data, batchId: batch.id, kind: l.kind, lineKey: l.code, categoryId: l.categoryId,
              appPiastres: l.kind === "check" ? (expected.get(l.code)?.app ?? null) : null, amountPiastres: BigInt(l.amount), note: l.note,
            })),
          );
          const cash = lines.find((l) => l.code === "balance:cash");
          const bank = lines.find((l) => l.code === "balance:bank");
          if (cash || bank)
            await tx.insert(balanceSnapshot).values({
              branchId: branchId.data, month: first, batchId: batch.id,
              cashPiastres: cash ? BigInt(cash.amount) : null, bankPiastres: bank ? BigInt(bank.amount) : null,
            });
          return { count: lines.length };
        },
        { reason: "month-close template" },
      ),
    );
    if ("error" in r) return { status: "error", code: r.error ?? "unknown" };
    revalidatePath(`/${loc}/month-close`);
    return { status: "done", count: r.count };
  } catch (e) {
    return { status: "error", code: dbErrorCode(e) };
  }
}

/** Removes the month's uploaded figures in one step (spec rule 13), while the month is open. */
export async function rollbackMonthClose(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const month = monthParam.parse(fd.get("month"));
  const batchId = z.uuid().parse(fd.get("batchId"));
  await runAndReturn(loc, `/month-close?branch=${branchId}&month=${month}`, async () => {
    if (!canCloseMonth(user, branchId)) return { error: "forbidden" };
    return withClosingErrors(() =>
      withUserDb(user.id, async (tx) => {
        const [b] = await tx.select().from(importBatch).where(and(eq(importBatch.id, batchId), eq(importBatch.branchId, branchId), eq(importBatch.kind, "month_close")));
        if (!b || b.status !== "committed") return { error: "not_pending" };
        await tx.delete(periodImportLine).where(eq(periodImportLine.batchId, batchId));
        await tx.delete(balanceSnapshot).where(eq(balanceSnapshot.batchId, batchId));
        await tx.update(importBatch).set({ status: "rolled_back", rolledBackAt: new Date() }).where(eq(importBatch.id, batchId));
        return { extra: { done: "rolledBack" } };
      }),
    );
  });
}

/** The accountant closes the month: its figures become Verified and its money records are locked. */
export async function closeMonth(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const month = monthParam.parse(fd.get("month"));
  await runAndReturn(loc, `/month-close?branch=${branchId}&month=${month}`, async () => {
    if (!canCloseMonth(user, branchId)) return { error: "forbidden" };
    return withClosingErrors(() =>
      withUserDb(user.id, async (tx) => {
        const p = await period(tx, branchId, `${month}-01`);
        await tx.execute(sql`select app_close_period(${p.id})`);
        return { extra: { done: "monthClosed" } };
      }),
    );
  });
}

/** The accountant asks the owner to reopen a closed month, with a reason. */
export async function requestReopen(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const month = monthParam.parse(fd.get("month"));
  await runAndReturn(loc, `/month-close?branch=${branchId}&month=${month}`, async () => {
    const reason = z.string().trim().max(1000).parse(fd.get("reason") ?? "");
    if (!canCloseMonth(user, branchId)) return { error: "forbidden" };
    return withClosingErrors(() =>
      withUserDb(user.id, async (tx) => {
        const p = await period(tx, branchId, `${month}-01`);
        await tx.execute(sql`select app_request_period_reopen(${p.id}, ${reason})`);
        return { extra: { done: "reopenAsked" } };
      }),
    );
  });
}

/** The owner reopens the month or keeps it closed. Never on their own request (checked in the database). */
export async function decideReopen(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const periodId = z.uuid().parse(fd.get("periodId"));
  const approve = fd.get("decision") === "reopen";
  const back = String(fd.get("back") ?? "/inbox").startsWith("/month-close") ? String(fd.get("back")) : "/inbox";
  await runAndReturn(loc, back, async () => {
    return withClosingErrors(() =>
      withUserDb(user.id, async (tx) => {
        const [p] = await tx.select({ branchId: periodClose.branchId }).from(periodClose).where(eq(periodClose.id, periodId));
        if (!p || !canReopenMonth(user, p.branchId)) return { error: "forbidden" };
        await tx.execute(sql`select app_decide_period_reopen(${periodId}, ${approve})`);
        return { extra: { done: approve ? "reopened" : "keptClosed" } };
      }),
    );
  });
}
