"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { withSafetyErrors } from "@/db/safety-errors";
import { hasFile, saveUpload, checkUpload } from "@/db/attachments";
import { issue } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { requireUser } from "@/lib/require-user";
import { ISSUE_CATEGORIES, ISSUE_PRIORITIES } from "@/db/schema";
import { sendSoon } from "@/lib/alert-job";

const locale = z.enum(["ar", "en"]).catch("ar");

/** Reports an issue (spec §8.8). Anyone who may report; only managers assign and set a due date (enforced by the database). */
export async function createIssue(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const photo = fd.get("photo");
  await runAndReturn(loc, "/issues/new", async () => {
    const data = z
      .object({
        branchId: z.uuid(),
        category: z.enum(ISSUE_CATEGORIES),
        priority: z.enum(ISSUE_PRIORITIES),
        title: z.string().trim().min(3).max(200),
        details: z.string().trim().max(4000),
      })
      .parse({
        branchId: fd.get("branchId"),
        category: fd.get("category"),
        priority: fd.get("priority") ?? "normal",
        title: fd.get("title") ?? "",
        details: fd.get("details") ?? "",
      });
    if (hasFile(photo)) {
      try {
        checkUpload(photo);
      } catch {
        return { error: "bad_file" };
      }
    }
    const newId = await withUserDb(user.id, async (tx) => {
      const att = hasFile(photo) ? await saveUpload(tx, data.branchId, photo) : null;
      const [row] = await tx
        .insert(issue)
        .values({ ...data, details: data.details || null, photoAttachmentId: att })
        .returning({ id: issue.id });
      return row.id;
    });
    sendSoon();
    // runAndReturn redirects to the form; the new issue's page is the better place, so go there instead.
    return { extra: { done: "issueCreated", id: newId } };
  });
}

async function onIssue(fd: FormData, work: (userId: string, issueId: string) => Promise<void | { error: string }>) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const issueId = z.uuid().parse(fd.get("issueId"));
  await runAndReturn(loc, `/issues/${issueId}`, async () => {
    const r = await withSafetyErrors(() => work(user.id, issueId));
    if (r && "error" in r) return r;
    sendSoon();
    return { extra: { done: "issueSaved" } };
  });
}

/** Branch manager or company manager: who does it, by when, and the priority. */
export async function planIssue(fd: FormData) {
  await onIssue(fd, (u, i) => {
    const data = z
      .object({
        assignedTo: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
        dueOn: z.union([z.iso.date(), z.literal("")]).transform((v) => v || null),
        priority: z.enum(ISSUE_PRIORITIES),
      })
      .parse({ assignedTo: fd.get("assignedTo") ?? "", dueOn: fd.get("dueOn") ?? "", priority: fd.get("priority") });
    return withUserDb(u, async (tx) => {
      const r = await tx.update(issue).set(data).where(eq(issue.id, i)).returning({ id: issue.id });
      if (r.length === 0) return { error: "forbidden" };
    });
  });
}

/** Start, finish (with a note) or reopen. The manager or the person it is assigned to. */
export async function moveIssue(fd: FormData) {
  await onIssue(fd, (u, i) => {
    const status = z.enum(["open", "in_progress", "resolved"]).parse(fd.get("status"));
    const note = z.string().trim().max(2000).parse(fd.get("note") ?? "");
    return withUserDb(u, async (tx) => {
      const r = await tx
        .update(issue)
        .set({ status, ...(status === "resolved" ? { resolutionNote: note || null } : {}) })
        .where(eq(issue.id, i))
        .returning({ id: issue.id });
      if (r.length === 0) return { error: "forbidden" };
    });
  });
}
