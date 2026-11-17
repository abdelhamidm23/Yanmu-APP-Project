import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/** Health check for uptime monitoring (spec §15.2). Reveals no data. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
