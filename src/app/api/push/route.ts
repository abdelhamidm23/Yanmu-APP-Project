import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { pushSubscription } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { pushPublicKey } from "@/lib/notifier";

const subscription = z.object({
  endpoint: z.url().max(1000).refine((u) => u.startsWith("https://")),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** The server's public key, or null when push is not set up (alerts still show inside the app). */
export async function GET() {
  return NextResponse.json({ publicKey: pushPublicKey() });
}

/** Turns on alerts for this phone, for the signed-in person only. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const parsed = subscription.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const s = parsed.data;
  await withUserDb(user.id, (tx) =>
    tx
      .insert(pushSubscription)
      .values({ userId: user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth })
      .onConflictDoNothing(),
  );
  return NextResponse.json({ ok: true });
}

/** Turns alerts off for this phone. */
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const parsed = z.object({ endpoint: z.string().max(1000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await withUserDb(user.id, (tx) =>
    tx.delete(pushSubscription).where(and(eq(pushSubscription.userId, user.id), eq(pushSubscription.endpoint, parsed.data.endpoint))),
  );
  return NextResponse.json({ ok: true });
}
