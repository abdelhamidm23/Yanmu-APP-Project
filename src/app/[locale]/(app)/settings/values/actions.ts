"use server";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { writeOrgSetting } from "@/db/settings";
import { runAndReturn } from "@/lib/action-result";
import { requireSettings } from "@/lib/require-user";
import { SETTING_GROUPS, SETTINGS, parseSettingInput } from "@/lib/settings";

/** Saves every threshold in one group. All values are validated before anything is written. */
export async function saveValues(fd: FormData) {
  const loc = z.enum(["ar", "en"]).catch("ar").parse(fd.get("locale"));
  const user = await requireSettings(loc, "admin");
  await runAndReturn(loc, "/settings/values", async () => {
    const group = z.enum(SETTING_GROUPS).parse(fd.get("group"));
    const defs = SETTINGS.filter((s) => s.group === group && s.kind !== "weekdays");
    const values = defs.map((d) => [d.key, parseSettingInput(d.key, String(fd.get(d.key) ?? ""))] as const);
    await withUserDb(user.id, async (tx) => {
      for (const [key, value] of values) await writeOrgSetting(tx, key, value);
    }, { reason: "thresholds changed in settings" });
  });
}
