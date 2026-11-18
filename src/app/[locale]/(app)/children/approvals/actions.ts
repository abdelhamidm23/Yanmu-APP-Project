"use server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb, dbRuleCode } from "@/db/rls";
import { approvalRequest, enrollment } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { requireUser } from "@/lib/require-user";
import { isOwner } from "@/lib/permissions";

const locale = z.enum(["ar", "en"]).catch("ar");
const optional = z.string().trim().max(500).optional().transform((v) => v || null);

async function decide(fd: FormData, work: (userId: string) => Promise<void | { error: string }>) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branch = z.uuid().safeParse(fd.get("branchId"));
  await runAndReturn(loc, `/children/approvals${branch.success ? `?branch=${branch.data}` : ""}`, async () => {
    try {
      return await work(user.id);
    } catch (e) {
      const rule = dbRuleCode(e);
      if (rule) return { error: rule };
      throw e;
    }
  });
}

/** Owner approves or declines a child past the licence limit (spec D11). The database checks who decides. */
export async function decideOverCapacity(fd: FormData) {
  await decide(fd, async (userId) => {
    const id = z.uuid().parse(fd.get("id"));
    const approve = fd.get("decision") === "approve";
    const note = optional.parse(fd.get("note") ?? "");
    const user = await requireUser(locale.parse(fd.get("locale")));
    if (!isOwner(user)) return { error: "forbidden" };
    await withUserDb(userId, (tx) => tx.execute(sql`select app_decide_over_capacity(${id}, ${approve}, ${note})`));
  });
}

/** Receiving branch manager accepts a transfer into a room, or declines it (spec §8.1). */
export async function decideTransfer(fd: FormData) {
  await decide(fd, async (userId) => {
    const id = z.uuid().parse(fd.get("id"));
    const accept = fd.get("decision") === "accept";
    const data = z
      .object({ roomId: z.union([z.uuid(), z.literal("")]), startDate: z.union([z.iso.date(), z.literal("")]), note: optional, bandReason: optional })
      .parse({ roomId: fd.get("roomId") ?? "", startDate: fd.get("startDate") ?? "", note: fd.get("note") ?? "", bandReason: fd.get("bandReason") ?? "" });
    if (accept && (!data.roomId || !data.startDate)) return { error: "invalid" };
    await withUserDb(userId, (tx) =>
      tx.execute(sql`select app_decide_transfer(${id}, ${accept}, ${data.roomId || null}::uuid, ${data.startDate || null}::date, ${data.note}, ${data.bandReason})`),
    );
  });
}

/** Whoever asked can withdraw their own request while it waits. */
export async function cancelRequest(fd: FormData) {
  await decide(fd, async (userId) => {
    const id = z.uuid().parse(fd.get("id"));
    const ok = await withUserDb(userId, async (tx) => {
      const rows = await tx
        .update(approvalRequest)
        .set({ status: "cancelled" })
        .where(and(eq(approvalRequest.id, id), eq(approvalRequest.status, "pending")))
        .returning({ enrollmentId: approvalRequest.enrollmentId });
      // The child no longer waits for a place.
      if (rows[0]?.enrollmentId) {
        await tx.update(enrollment).set({ status: "declined" }).where(and(eq(enrollment.id, rows[0].enrollmentId), eq(enrollment.status, "pending_approval")));
      }
      return rows.length > 0;
    });
    if (!ok) return { error: "forbidden" };
  });
}
