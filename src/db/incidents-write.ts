import "server-only";
import { sql } from "drizzle-orm";
import { incident, incidentPerson } from "./schema";
import type { Tx } from "./rls";
import { effectiveSeverity, type IncidentDraft } from "@/lib/incidents";

/**
 * Saves a short-form incident and its children. A second send of the same report (offline resend)
 * returns the first one's id instead of saving it twice.
 */
export async function saveIncidentDraft(tx: Tx, d: IncidentDraft): Promise<{ id: string; severity: string; duplicate: boolean }> {
  const [existing] = (await tx.execute(sql`select id, severity from incident where client_uuid = ${d.clientUuid}`)) as unknown as { id: string; severity: string }[];
  if (existing) return { ...existing, duplicate: true };
  const occurred = new Date(d.occurredAt);
  const [row] = await tx
    .insert(incident)
    .values({
      branchId: d.branchId,
      roomId: d.roomId,
      occurredAt: occurred,
      category: d.category,
      severity: effectiveSeverity(d.category, d.severity),
      description: d.description,
      immediateAction: d.immediateAction,
      guardianNotifiedAt: d.guardianTold ? new Date() : null,
      guardianNotificationNote: d.guardianTold ? d.guardianNote : null,
      clientUuid: d.clientUuid,
    })
    .returning({ id: incident.id, severity: incident.severity });
  for (const s of Array.from(new Set(d.studentIds))) {
    await tx.insert(incidentPerson).values({ incidentId: row.id, branchId: d.branchId, studentId: s, role: "involved" });
  }
  return { ...row, duplicate: false };
}
