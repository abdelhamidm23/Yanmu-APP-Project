import "server-only";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { redirect } from "@/i18n/navigation";
import { dbErrorCode } from "@/db/rls";

/**
 * Runs a settings write and returns to `path` with ?ok=1 or ?error=<code>.
 * Errors from row-level security become "forbidden"; validation errors become "invalid".
 */
export async function runAndReturn(locale: string, path: string, work: () => Promise<void | { error: string } | { extra: Record<string, string> }>) {
  let query = "ok=1";
  try {
    const r = await work();
    if (r && "error" in r) query = `error=${r.error}`;
    if (r && "extra" in r) query += "&" + new URLSearchParams(r.extra).toString();
  } catch (e) {
    if (e instanceof ZodError) query = "error=invalid";
    else {
      console.error("settings action failed", dbErrorCode(e));
      query = `error=${dbErrorCode(e)}`;
    }
  }
  revalidatePath(`/${locale}${path.split("?")[0]}`);
  redirect({ href: `${path}${path.includes("?") ? "&" : "?"}${query}`, locale });
}
