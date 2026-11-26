import { z } from "zod";
import { withUserDb, dbErrorCode } from "@/db/rls";
import { saveIncidentDraft } from "@/db/incidents-write";
import { incidentDraftSchema } from "@/lib/incidents";
import { getCurrentUser } from "@/lib/session";
import { canReportSafety } from "@/lib/permissions";
import { sendSoon } from "@/lib/alert-job";

const body = z.object({ incidents: z.array(incidentDraftSchema).min(1).max(20) });

/**
 * Receives incident short forms (spec §8.7), sent straight away or later from a phone that was offline.
 * Answers per report; a resend of the same report is harmless (client_uuid).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.mustSetUpMfa) return Response.json({ error: "signed_out" }, { status: 401 });
  if (!canReportSafety(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const results: { clientUuid: string; id?: string; error?: string }[] = [];
  for (const d of parsed.data.incidents) {
    try {
      const r = await withUserDb(user.id, (tx) => saveIncidentDraft(tx, d));
      results.push({ clientUuid: d.clientUuid, id: r.id });
    } catch (e) {
      const msg = (e as { cause?: { message?: string }; message?: string }).cause?.message ?? (e as { message?: string }).message;
      results.push({ clientUuid: d.clientUuid, error: msg === "invalid date" ? "invalid_date" : dbErrorCode(e) });
    }
  }
  sendSoon();
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
