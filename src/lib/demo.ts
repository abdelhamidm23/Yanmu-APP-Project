/**
 * Demo mode (docs/SPEC.md §16): the online preview with test accounts and made-up data.
 * Never true in production. Every screen shows the "Demo data" pill.
 */
import type { Role } from "./roles";

export const isDemoMode = () => process.env.DEMO_MODE === "true";

type Grant = [Role, "A" | "B" | null]; // null = organization-wide

/** One test account per role. Used by the seed script and listed on the sign-in screen in demo mode. */
export const DEMO_ACCOUNTS: { email: string; name: string; locale: "ar" | "en"; roles: Grant[] }[] = [
  { email: "owner@yanmu.test", name: "Owner (test)", locale: "ar", roles: [["owner", null]] },
  { email: "company.manager@yanmu.test", name: "Company manager (test)", locale: "ar", roles: [["company_manager", null]] },
  { email: "branch.manager@yanmu.test", name: "Branch manager A (test)", locale: "ar", roles: [["branch_manager", "A"]] },
  { email: "branch.manager.b@yanmu.test", name: "Branch manager B (test)", locale: "ar", roles: [["branch_manager", "B"]] },
  { email: "accountant@yanmu.test", name: "Accountant (test)", locale: "ar", roles: [["accountant", null]] },
  { email: "hr@yanmu.test", name: "HR (test)", locale: "ar", roles: [["hr", null]] },
  { email: "front.desk@yanmu.test", name: "Front desk A (test)", locale: "ar", roles: [["front_desk", "A"]] },
  { email: "teacher@yanmu.test", name: "Teacher A (test)", locale: "ar", roles: [["teacher", "A"]] },
  { email: "multi.role@yanmu.test", name: "Two roles (test)", locale: "en", roles: [["front_desk", "B"], ["teacher", "B"]] },
];
