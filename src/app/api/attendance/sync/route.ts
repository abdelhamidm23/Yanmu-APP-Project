import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { applyAttendanceEvents } from "@/db/attendance-sync";
import { attendanceEventSchema } from "@/lib/attendance";
import { getCurrentUser } from "@/lib/session";
import { canTakeAttendance } from "@/lib/permissions";

const body = z.object({ events: z.array(attendanceEventSchema).min(1).max(300) });

/** Receives the taps a class phone queued (spec §8.2). Answers per tap; the phone keeps rejected ones visible. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.mustSetUpMfa) return Response.json({ error: "signed_out" }, { status: 401 });
  if (!canTakeAttendance(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const out = await withUserDb(user.id, (tx) => applyAttendanceEvents(tx, parsed.data.events));
  return Response.json(out, { headers: { "Cache-Control": "no-store" } });
}
