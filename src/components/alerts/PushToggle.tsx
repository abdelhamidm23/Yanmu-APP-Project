"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type State = "loading" | "unsupported" | "notSetUp" | "denied" | "off" | "on" | "failed";

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** "Alerts on this phone" in More (spec §10): push notifications through the browser. */
export function PushToggle() {
  const t = useTranslations("alerts.push");
  const [state, setState] = useState<State>("loading");
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      const r = await fetch("/api/push").then((x) => x.json()).catch(() => ({ publicKey: null }));
      if (!r.publicKey) return setState("notSetUp");
      setKey(r.publicKey);
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function turnOn() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState("denied");
      const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key!) });
      const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      setState(res.ok ? "on" : "failed");
    } catch {
      setState("failed");
    }
  }

  async function turnOff() {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
    setState("off");
  }

  const button = "inline-flex min-h-11 items-center justify-center rounded-button px-4 font-semibold";
  return (
    <div className="flex flex-col gap-2" data-testid="push-toggle">
      <p className="text-[14px] text-subtle">{t("help")}</p>
      {state === "on" ? (
        <>
          <p className="text-verified-fg">{t("enabled")}</p>
          <button type="button" onClick={turnOff} className={`${button} self-start border border-outline bg-surface text-ink`}>{t("off")}</button>
        </>
      ) : state === "off" || state === "failed" ? (
        <>
          {state === "failed" ? <p className="text-critical">{t("failed")}</p> : null}
          <button type="button" onClick={turnOn} className={`${button} self-start bg-brand text-white`} data-testid="push-on">{t("on")}</button>
        </>
      ) : state === "loading" ? null : (
        <p className="text-attention">{t(state)}</p>
      )}
    </div>
  );
}
