import { z } from "zod";
import { ROLES, type Role } from "@/lib/roles";

/** Roles that only make sense for one branch (spec §5 "own"/"room"). */
export const BRANCH_ONLY: readonly Role[] = ["branch_manager", "front_desk", "teacher"];
/** Roles that are always organization-wide. */
export const ORG_ONLY: readonly Role[] = ["owner", "company_manager"];

export interface Grant {
  role: Role;
  branchId: string | null;
}

/** Checkbox values look like "teacher:<branch uuid>" or "accountant:all". */
export function parseGrants(values: FormDataEntryValue[]): Grant[] {
  const grants = values.map((v) => {
    const [role, scope] = String(v).split(":");
    return z
      .object({ role: z.enum(ROLES), branchId: z.union([z.literal("all").transform(() => null), z.uuid()]) })
      .parse({ role, branchId: scope });
  });
  for (const g of grants) {
    if (g.branchId === null && BRANCH_ONLY.includes(g.role)) throw new z.ZodError([]);
    if (g.branchId !== null && ORG_ONLY.includes(g.role)) throw new z.ZodError([]);
  }
  return grants;
}

export const grantKey = (g: Grant) => `${g.role}:${g.branchId ?? "all"}`;

/** Readable temporary password, e.g. "Kite-7342-Maple". */
export function temporaryPassword(): string {
  const words = ["Palm", "Nile", "Lotus", "Maple", "Cedar", "Kite", "Olive", "River", "Amber", "Coral", "Dune", "Mint"];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  const digits = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
  return `${pick()}-${digits}-${pick()}`;
}
