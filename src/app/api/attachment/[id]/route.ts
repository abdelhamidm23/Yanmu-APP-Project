import { eq } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { attachment } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

/** Photos and signed forms. Row-level security decides who may read each file (spec §5). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  const user = await getCurrentUser();
  if (!id.success || !user || user.mustSetUpMfa) return new Response("Not found", { status: 404 });
  const [file] = await withUserDb(user.id, (tx) => tx.select().from(attachment).where(eq(attachment.id, id.data)));
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
