"use server";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { withClosingErrors } from "@/db/closing-errors";
import { dayFacts, emptySection } from "@/db/closing";
import { dailyClose, DAILY_CLOSE_SECTIONS } from "@/db/schema";
import { runAndReturn } from "@/lib/action-result";
import { canCloseDay } from "@/lib/permissions";
import { requireUser } from "@/lib/require-user";
import { todayInCairo } from "@/lib/calendar";

const locale = z.enum(["ar", "en"]).catch("ar");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Closes a branch's day (spec §8.9): one answer per section, the day's facts kept with it.
 * The database checks every section is answered and that "To fix" has a note.
 */
export async function closeDay(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const branchId = z.uuid().parse(fd.get("branchId"));
  const date = isoDate.parse(fd.get("date"));
  await runAndReturn(loc, `/daily-close?branch=${branchId}&date=${date}`, async () => {
    if (!canCloseDay(user, branchId)) return { error: "forbidden" };
    if (date > todayInCairo()) return { error: "invalid_date" };
    const notes = z.string().trim().max(2000).parse(fd.get("notes") ?? "");
    return withClosingErrors(() =>
      withUserDb(
        user.id,
        async (tx) => {
          const facts = await dayFacts(tx, branchId, date);
          const sections: Record<string, { state: string; note?: string; facts: unknown }> = {};
          for (const s of DAILY_CLOSE_SECTIONS) {
            const raw = String(fd.get(`s-${s}`) ?? "");
            const note = String(fd.get(`n-${s}`) ?? "").trim().slice(0, 500);
            // Each section is a Yes/No question where "Yes" means something to report (stored as "fix",
            // details required). "No" is "none" for a section with nothing in it, otherwise "correct".
            const empty = emptySection(s, facts);
            const state = raw === "yes" ? "fix" : raw === "no" ? (empty ? "none" : "correct") : "";
            if (!state) return { error: "section_missing" };
            sections[s] = { state, ...(note ? { note } : {}), facts: facts[s] };
          }
          await tx.insert(dailyClose).values({ branchId, date, sections, notes: notes || null });
          return { extra: { done: "dayClosed" } };
        },
        { reason: "daily close" },
      ),
    );
  });
}
