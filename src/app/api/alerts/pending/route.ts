import { NextResponse } from "next/server";
import { withUserDb } from "@/db/rls";
import { pendingCritical, unreadAlertCount } from "@/db/safety";
import { getCurrentUser } from "@/lib/session";

/** What the alert watcher on each open screen needs: unacknowledged critical alerts and the unread count. Ids only. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const r = await withUserDb(user.id, async (tx) => ({
    critical: (await pendingCritical(tx, user.id)).map((a) => a.id),
    unread: await unreadAlertCount(tx, user.id),
  }));
  return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
}
