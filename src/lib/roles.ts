/**
 * Roles and per-role navigation (docs/SPEC.md §5 and §11.1).
 * This file is the single source of truth for which sections a role may open;
 * the server checks it on every page load, so hiding a tab is never the only guard.
 */
export const ROLES = [
  "owner",
  "company_manager",
  "branch_manager",
  "accountant",
  "hr",
  "front_desk",
  "teacher",
] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Roles that must use two-step sign-in (MFA), spec §14. */
export const PRIVILEGED_ROLES: readonly Role[] = ["owner", "company_manager", "accountant", "hr"];

export function requiresMfa(roles: readonly Role[]): boolean {
  return roles.some((r) => PRIVILEGED_ROLES.includes(r));
}

export const SECTIONS = [
  "home",
  "branches",
  "inbox",
  "reports",
  "issues",
  "today",
  "children",
  "add",
  "money",
  "invoices",
  "month-close",
  "payment",
  "cash-box",
  "my-room",
  "roll-call",
  "incident",
  "staff",
  "staff-attendance",
  "more",
] as const;
export type Section = (typeof SECTIONS)[number];

export type NavIcon =
  | "home"
  | "building"
  | "inbox"
  | "chart"
  | "wrench"
  | "sun"
  | "child"
  | "plus"
  | "money"
  | "receipt"
  | "calendar-check"
  | "cash"
  | "door"
  | "check-list"
  | "alert"
  | "people"
  | "clock"
  | "more";

export interface NavItem {
  section: Section;
  icon: NavIcon;
  /** "+ Add"-style buttons are drawn as the primary action. */
  primary?: boolean;
  /** Shows a count badge (Inbox). */
  badge?: boolean;
}

const more: NavItem = { section: "more", icon: "more" };

/** Spec §11.1. HR is not in the table there; its shell is our default (see CLAUDE.md, open items). */
export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  owner: [
    { section: "home", icon: "home" },
    { section: "branches", icon: "building" },
    { section: "inbox", icon: "inbox", badge: true },
    { section: "reports", icon: "chart" },
    more,
  ],
  company_manager: [
    { section: "home", icon: "home" },
    { section: "branches", icon: "building" },
    { section: "inbox", icon: "inbox", badge: true },
    { section: "issues", icon: "wrench" },
    more,
  ],
  branch_manager: [
    { section: "today", icon: "sun" },
    { section: "children", icon: "child" },
    { section: "add", icon: "plus", primary: true },
    { section: "issues", icon: "wrench" },
    more,
  ],
  accountant: [
    { section: "money", icon: "money" },
    { section: "invoices", icon: "receipt" },
    { section: "add", icon: "plus", primary: true },
    { section: "month-close", icon: "calendar-check" },
    more,
  ],
  hr: [
    { section: "staff", icon: "people" },
    { section: "staff-attendance", icon: "clock" },
    more,
  ],
  front_desk: [
    { section: "today", icon: "sun" },
    { section: "children", icon: "child" },
    { section: "payment", icon: "plus", primary: true },
    { section: "cash-box", icon: "cash" },
    more,
  ],
  teacher: [
    { section: "my-room", icon: "door" },
    { section: "roll-call", icon: "check-list" },
    { section: "incident", icon: "plus", primary: true },
    more,
  ],
};

/** Order used to pick a default role when a person holds several. */
const ROLE_PRIORITY: Role[] = [...ROLES];

export function primaryRole(roles: readonly Role[]): Role | null {
  return ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null;
}

export function homeSection(role: Role): Section {
  return NAV_BY_ROLE[role][0].section;
}

export function canOpenSection(role: Role, section: string): section is Section {
  return NAV_BY_ROLE[role].some((item) => item.section === section);
}

/** Items in the "+ Add" sheet (spec §11.1), filtered by role per §5. */
export const ADD_ACTIONS = ["payment", "expense", "incident", "issue", "child", "roll-call"] as const;
export type AddAction = (typeof ADD_ACTIONS)[number];

const ADD_BY_ROLE: Partial<Record<Role, AddAction[]>> = {
  branch_manager: ["payment", "expense", "incident", "issue", "child", "roll-call"],
  accountant: ["payment", "expense"],
};

export function addActionsFor(role: Role): AddAction[] {
  return ADD_BY_ROLE[role] ?? [];
}

/** Which build phase delivers each section (docs/SPEC.md §18), shown on placeholder screens. */
export const SECTION_PHASE: Record<Section, number> = {
  home: 7,
  branches: 7,
  inbox: 7,
  reports: 7,
  issues: 5,
  today: 3,
  children: 2,
  add: 4,
  money: 4,
  invoices: 4,
  "month-close": 6,
  payment: 4,
  "cash-box": 4,
  "my-room": 3,
  "roll-call": 3,
  incident: 5,
  staff: 3,
  "staff-attendance": 3,
  more: 1,
};
