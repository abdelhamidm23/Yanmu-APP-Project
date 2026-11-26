/**
 * Where the header's Back button goes (owner, 2026-11-26: "every page needs a way back").
 *
 * - A tab of the person's bottom navigation is a starting point: no Back button.
 * - A page under another (`/children/123`, `/settings/users/new`) goes up one level.
 *   `/settings/…` goes to More, where the settings are listed (not every role may open /settings).
 * - A top-level page that is not one of the person's tabs (`/daily-close`, `/figures`) goes back to
 *   the top-level page it was opened from (Today, Home, …) when there was one, otherwise to More,
 *   which lists every such page.
 *
 * Every parent here is a page that needs no more rights than its child, so Back never leads to a
 * page the person cannot open.
 */
export function backTarget(pathname: string, tabs: readonly string[], cameFrom?: string | null): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    if (tabs.includes(parts[0])) return null;
    const from = cameFrom?.split("?")[0].split("/").filter(Boolean) ?? [];
    if (from.length === 1 && from[0] !== parts[0]) return `/${from[0]}`;
    return "/more";
  }
  const parent = `/${parts.slice(0, -1).join("/")}`;
  return parent === "/settings" ? "/more" : parent;
}
