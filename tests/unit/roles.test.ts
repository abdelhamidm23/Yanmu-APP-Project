import { describe, expect, it } from "vitest";
import {
  addActionsFor,
  canOpenSection,
  homeSection,
  NAV_BY_ROLE,
  primaryRole,
  requiresMfa,
  ROLES,
  SECTION_PHASE,
} from "@/lib/roles";

const sections = (role: (typeof ROLES)[number]) => NAV_BY_ROLE[role].map((i) => i.section);

describe("bottom navigation matches spec §11.1", () => {
  it.each([
    ["owner", ["home", "branches", "inbox", "reports", "more"]],
    ["company_manager", ["home", "branches", "inbox", "issues", "more"]],
    ["branch_manager", ["today", "children", "add", "issues", "more"]],
    ["accountant", ["money", "invoices", "add", "month-close", "more"]],
    ["front_desk", ["today", "children", "paid", "more"]],
    ["teacher", ["my-class", "roll-call", "incident", "more"]],
  ] as const)("%s", (role, expected) => {
    expect(sections(role)).toEqual(expected);
  });

  it("every role has a More tab and at most 5 tabs", () => {
    for (const role of ROLES) {
      expect(sections(role)).toContain("more");
      expect(NAV_BY_ROLE[role].length).toBeLessThanOrEqual(5);
    }
  });

  it("every section has a delivery phase", () => {
    for (const role of ROLES) for (const s of sections(role)) expect(SECTION_PHASE[s]).toBeGreaterThan(0);
  });
});

describe("section access", () => {
  it("a teacher cannot open owner screens", () => {
    expect(canOpenSection("teacher", "inbox")).toBe(false);
    expect(canOpenSection("teacher", "home")).toBe(false);
    expect(canOpenSection("teacher", "roll-call")).toBe(true);
  });

  it("front desk cannot open finance month close", () => {
    expect(canOpenSection("front_desk", "month-close")).toBe(false);
  });

  it("start screen is the first tab", () => {
    expect(homeSection("owner")).toBe("home");
    expect(homeSection("teacher")).toBe("my-class");
  });
});

describe("MFA for privileged roles (spec §14)", () => {
  it.each(["owner", "company_manager", "accountant", "hr"] as const)("%s requires MFA", (role) => {
    expect(requiresMfa([role])).toBe(true);
  });
  it.each(["branch_manager", "front_desk", "teacher"] as const)("%s does not", (role) => {
    expect(requiresMfa([role])).toBe(false);
  });
  it("any privileged role in the set requires MFA", () => {
    expect(requiresMfa(["teacher", "accountant"])).toBe(true);
  });
});

describe("helpers", () => {
  it("picks the highest role as default", () => {
    expect(primaryRole(["teacher", "front_desk"])).toBe("front_desk");
    expect(primaryRole([])).toBeNull();
  });
  it("+ Add sheet is filtered by role", () => {
    expect(addActionsFor("accountant")).toEqual(["payment", "expense"]);
    expect(addActionsFor("teacher")).toEqual([]);
  });
});
