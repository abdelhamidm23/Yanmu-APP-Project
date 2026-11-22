"use server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { withMoneyErrors } from "@/db/money-errors";
import { runAndReturn } from "@/lib/action-result";
import { requireUser } from "@/lib/require-user";

const locale = z.enum(["ar", "en"]).catch("ar");
const DECISIONS = ["approve", "reject", "question", "recommend_approve", "recommend_reject"] as const;

/** Approve, reject, ask a question, or recommend (spec §8.6). The database checks who may and when. */
export async function decide(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const requestId = z.uuid().parse(fd.get("requestId"));
  await runAndReturn(loc, "/inbox", async () => {
    const decision = z.enum(DECISIONS).parse(fd.get("decision"));
    const comment = z.string().trim().max(1000).parse(fd.get("comment") ?? "");
    return withMoneyErrors(() =>
      withUserDb(
        user.id,
        async (tx) => {
          const [r] = (await tx.execute(sql`select app_decide_money(${requestId}, ${decision}, ${comment}) as s`)) as unknown as { s: string }[];
          return { extra: { done: r.s === "approved" ? "approved" : r.s === "declined" ? "declined" : r.s === "question" ? "asked" : "recommended" } };
        },
        { reason: comment || undefined },
      ),
    );
  });
}
