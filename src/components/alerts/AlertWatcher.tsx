"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import { flushIncidents } from "@/lib/incident-outbox";

/**
 * Keeps every open screen up to date with alerts (spec §10): checks every 30 seconds and when the
 * screen comes back into view, and refreshes the page when a critical alert arrives or is handled,
 * so the red banner appears or goes without anyone reloading. Also sends incident reports that were
 * saved on this phone without a connection.
 */
export function AlertWatcher({ userId, critical, unread }: { userId: string; critical: string[]; unread: number }) {
  const router = useRouter();
  const seen = useRef({ critical: critical.join(","), unread });

  useEffect(() => {
    seen.current = { critical: critical.join(","), unread };
  }, [critical, unread]);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/alerts/pending", { cache: "no-store" });
        if (!r.ok) return;
        const now = (await r.json()) as { critical: string[]; unread: number };
        const key = now.critical.join(",");
        if (key !== seen.current.critical || now.unread !== seen.current.unread) {
          const fresh = now.critical.some((id) => !seen.current.critical.split(",").includes(id));
          seen.current = { critical: key, unread: now.unread };
          if (fresh && "vibrate" in navigator) navigator.vibrate?.([300, 150, 300]);
          router.refresh();
        }
      } catch {
        // Offline: try again on the next tick.
      }
    };
    const flush = () => {
      if (navigator.onLine) flushIncidents(userId).then((o) => (o.sent.length ? router.refresh() : undefined)).catch(() => undefined);
    };
    const id = window.setInterval(check, 30_000);
    const onVisible = () => {
      check();
      flush();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    flush();
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [router, userId]);

  return null;
}
