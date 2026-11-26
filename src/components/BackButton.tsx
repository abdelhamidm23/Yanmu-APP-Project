"use client";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { backTarget } from "@/lib/back";

// Kept in sessionStorage (this tab only, cleared when it closes); holds page addresses, no personal data.
const KEY_CURRENT = "nav:current";
const KEY_GOING_BACK = "nav:back";
const keyFrom = (path: string) => `nav:from:${path}`;
const keyUrl = (path: string) => `nav:url:${path}`;
const ONE_OFF = ["ok", "error", "saved", "pin", "done", "msg"];

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: Back still works, it only forgets filters.
  }
}

/**
 * The start of the top bar: the app's name on a tab, a Back button on every other page
 * (owner, 2026-11-26). Where Back goes is `backTarget`; the page is reopened with the filters it
 * had when the person left it (for example the branch on the children list).
 */
export function HeaderStart({ tabs, appName }: { tabs: string[]; appName: string }) {
  const t = useTranslations("common");
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();

  useEffect(() => {
    const url = search ? `${pathname}?${search}` : pathname;
    const previous = read(KEY_CURRENT);
    const previousPath = previous?.split("?")[0];
    if (previousPath && previousPath !== pathname) {
      // Arriving by Back must not make the page we left its new "came from" (no loops).
      if (read(KEY_GOING_BACK)) write(KEY_GOING_BACK, null);
      else write(keyFrom(pathname), previous);
    }
    write(KEY_CURRENT, url);
    // Remember the filters, not one-off messages such as "Saved" or an error.
    const keep = new URLSearchParams(search);
    for (const k of ONE_OFF) keep.delete(k);
    write(keyUrl(pathname), keep.size ? `${pathname}?${keep}` : pathname);
  }, [pathname, search]);

  // The link's own address is the plain parent; a tap works out the exact page from this tab's history.
  const target = backTarget(pathname, tabs);
  if (!target) {
    return <span className="text-row-title font-semibold text-brand">{appName}</span>;
  }
  return (
    <Link
      href={target}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        const to = backTarget(pathname, tabs, read(keyFrom(pathname))) ?? target;
        const remembered = read(keyUrl(to));
        write(KEY_GOING_BACK, "1");
        router.push(remembered?.split("?")[0] === to ? remembered : to);
      }}
      className="-ms-2 inline-flex min-h-11 items-center gap-1.5 rounded-button px-2 text-row-title font-semibold text-brand hover:bg-surface"
      data-testid="back-button"
    >
      <ArrowLeft aria-hidden="true" className="size-5 rtl:-scale-x-100" />
      {t("back")}
    </Link>
  );
}
