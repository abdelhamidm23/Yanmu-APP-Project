"use client";
import { useEffect } from "react";

/** Registers public/sw.js so roll call opens without a connection (spec §13). Production builds only. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
