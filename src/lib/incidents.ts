import { z } from "zod";

/** The incident short form (spec §8.7): sent online, or kept on the phone and sent later (offline). */
export const INCIDENT_CATEGORY_KEYS = [
  "injury",
  "head_injury",
  "illness",
  "allergic_reaction",
  "behaviour",
  "child_unaccounted",
  "pickup_unapproved",
  "child_protection",
  "hazard",
  "other",
] as const;
export const INCIDENT_SEVERITY_KEYS = ["minor", "moderate", "serious", "critical"] as const;

/** Kinds of incident that are always critical (spec §8.7); the database enforces the same. */
export const ALWAYS_CRITICAL: readonly string[] = ["head_injury", "allergic_reaction", "child_unaccounted", "pickup_unapproved", "child_protection"];

export function effectiveSeverity(category: string, severity: string): string {
  return ALWAYS_CRITICAL.includes(category) ? "critical" : severity;
}

export const incidentDraftSchema = z.object({
  clientUuid: z.uuid(),
  branchId: z.uuid(),
  roomId: z.uuid().nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
  category: z.enum(INCIDENT_CATEGORY_KEYS),
  severity: z.enum(INCIDENT_SEVERITY_KEYS),
  description: z.string().trim().min(3).max(4000),
  immediateAction: z.string().trim().min(2).max(4000),
  studentIds: z.array(z.uuid()).max(40),
  guardianTold: z.boolean(),
  guardianNote: z.string().trim().max(2000).nullable(),
});
export type IncidentDraft = z.infer<typeof incidentDraftSchema>;
