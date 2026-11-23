"use server";
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { withUserDb, dbErrorCode } from "@/db/rls";
import { requireUser } from "@/lib/require-user";

const locale = z.enum(["ar", "en"]).catch("ar");
/** Only paths inside the app, so the form cannot send anyone elsewhere. */
const back = z.string().regex(/^\/[a-z0-9\-/?=&%._]*$/i).max(300).catch("/inbox");

/** "I'm on it" on an alert (spec §10): stops the repeats and the escalation for everyone. */
export async function ackAlert(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  const alertId = z.uuid().parse(fd.get("alertId"));
  const to = back.parse(fd.get("back") ?? "/inbox");
  let query = "ok=1&done=acknowledged";
  try {
    await withUserDb(user.id, (tx) => tx.execute(sql`select app_ack_alert(${alertId})`));
  } catch (e) {
    query = `error=${dbErrorCode(e)}`;
  }
  revalidatePath(`/${loc}`, "layout");
  redirect({ href: `${to}${to.includes("?") ? "&" : "?"}${query}`, locale: loc });
}

/** Marks this person's alerts as read (the bell's count goes to zero). */
export async function markAlertsRead(fd: FormData) {
  const loc = locale.parse(fd.get("locale"));
  const user = await requireUser(loc);
  await withUserDb(user.id, (tx) => tx.execute(sql`update notification set read_at = now() where user_id = ${user.id} and read_at is null`));
  revalidatePath(`/${loc}`, "layout");
  redirect({ href: "/inbox", locale: loc });
}
