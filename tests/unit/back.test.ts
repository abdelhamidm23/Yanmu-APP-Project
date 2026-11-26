import { describe, expect, it } from "vitest";
import { backTarget } from "@/lib/back";
import { NAV_BY_ROLE } from "@/lib/roles";

const tabs = (role: keyof typeof NAV_BY_ROLE) => NAV_BY_ROLE[role].map((i) => i.section);

describe("Back button target", () => {
  it("has no Back on the person's own tabs", () => {
    expect(backTarget("/today", tabs("branch_manager"))).toBeNull();
    expect(backTarget("/more", tabs("teacher"))).toBeNull();
    expect(backTarget("/home", tabs("owner"))).toBeNull();
  });

  it("goes up one level from an inner page", () => {
    expect(backTarget("/children/abc", tabs("branch_manager"))).toBe("/children");
    expect(backTarget("/home/overdue", tabs("owner"))).toBe("/home");
    expect(backTarget("/settings/users/new", tabs("owner"))).toBe("/settings/users");
    expect(backTarget("/today/roster", tabs("branch_manager"))).toBe("/today");
    expect(backTarget("/more/account", tabs("teacher"))).toBe("/more");
  });

  it("sends settings pages to More, where they are listed", () => {
    expect(backTarget("/settings/price-locks", tabs("accountant"))).toBe("/more");
    expect(backTarget("/settings", tabs("owner"))).toBe("/more");
  });

  it("returns a top-level page to the page it was opened from, else More", () => {
    expect(backTarget("/daily-close", tabs("owner"), "/today?branch=x")).toBe("/today");
    expect(backTarget("/figures", tabs("owner"), "/home")).toBe("/home");
    expect(backTarget("/figures", tabs("owner"))).toBe("/more");
    // Coming from an inner page or the same page is not a place to go back to.
    expect(backTarget("/figures", tabs("owner"), "/home/overdue")).toBe("/more");
    expect(backTarget("/figures", tabs("owner"), "/figures?branch=x")).toBe("/more");
  });

  it("an inner page goes up even when a tab of another role", () => {
    expect(backTarget("/roll-call/room1", tabs("branch_manager"))).toBe("/roll-call");
  });
});
