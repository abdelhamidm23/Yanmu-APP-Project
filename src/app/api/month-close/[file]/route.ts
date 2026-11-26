import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { branch } from "@/db/schema";
import { monthPack, templateLines, templateSheet } from "@/db/month-pack";
import { getCurrentUser } from "@/lib/session";
import { canViewMonth } from "@/lib/permissions";
import { buildBook, xlsxResponse } from "@/lib/excel";

const notFound = () => new Response("Not found", { status: 404 });

/** The month's Excel pack and the month-close template (spec §8.10), for the accountant, owner and company manager. */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") === "en" ? "en" : "ar";
  const user = await getCurrentUser();
  const branchId = z.uuid().safeParse(url.searchParams.get("branch"));
  const month = z.string().regex(/^\d{4}-\d{2}$/).safeParse(url.searchParams.get("month"));
  if (!user || user.mustSetUpMfa || !branchId.success || !month.success || (file !== "pack" && file !== "template")) return notFound();
  if (!canViewMonth(user, branchId.data)) return notFound();
  const t = await getTranslations({ locale });
  const first = `${month.data}-01`;
  const out = await withUserDb(user.id, async (tx) => {
    const [b] = await tx.select({ code: branch.code }).from(branch).where(eq(branch.id, branchId.data));
    if (!b) return null;
    const sheets = file === "pack" ? await monthPack(tx, branchId.data, first, locale, t, user.digits) : [templateSheet(await templateLines(tx, branchId.data, first, locale, t), t)];
    return { code: b.code, body: await buildBook(sheets, locale) };
  });
  if (!out) return notFound();
  // The file name starts with the month, so an upload of it is matched to the right month.
  return xlsxResponse(out.body, `${month.data} ${file === "pack" ? "month-pack" : "month-close"} ${out.code}.xlsx`);
}
