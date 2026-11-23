"use server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { visibleBranches } from "@/db/children";
import { flaggedFamilies } from "@/db/home";
import { runAndReturn } from "@/lib/action-result";
import { hasRoleIn } from "@/lib/permissions";
import { requireSection } from "@/lib/require-user";
import { todayInCairo } from "@/lib/calendar";

const locale = z.enum(["ar", "en"]).catch("ar");

/**
 * "Ask branches to call these families" (spec §11.3): one follow-up issue per branch with the account numbers
 * over the limits (no amounts: branch managers do not see money). The database checks who may ask.
 */
export async function askToCall(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireSection(loc, "home");
  const scope = z.union([z.literal("all"), z.uuid()]).parse(fd.get("branch"));
  await runAndReturn(loc, `/home/money_overdue?branch=${scope}`, async () => {
    const today = todayInCairo();
    const asked = await withUserDb(
      user.id,
      async (tx) => {
        const branches = (await visibleBranches(tx)).filter(
          (b) => (scope === "all" || b.id === scope) && hasRoleIn(user, ["owner", "company_manager"], b.id),
        );
        let n = 0;
        for (const b of branches) {
          const families = await flaggedFamilies(tx, b.id, today);
          if (families.length === 0) continue;
          const lines = families.map((f) => `${f.accountNo} · ${f.familyName} · ${f.days} ${f.days === 1 ? "day / يوم" : "days / يومًا"}`);
          await tx.execute(sql`select app_ask_to_call(${b.id}, ${"اتصل بالأسر المتأخرة · Call overdue families"},
            ${["Please call these families about their unpaid bills. / يُرجى الاتصال بهذه الأسر بخصوص الفواتير غير المدفوعة.", "", ...lines].join("\n")},
            ${families.every((f) => f.isDemo)})`);
          n += 1;
        }
        return n;
      },
      { reason: "ask branches to call overdue families" },
    );
    return asked ? { extra: { done: "asked", n: String(asked) } } : { error: "none_to_call" };
  });
}
