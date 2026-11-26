import webpush from "web-push";

/**
 * How alerts leave the app (spec §10, §13 "Web Push (VAPID) + SMS provider behind a Notifier interface").
 * Messages carry no names, health details or personal data (rule 9): only the kind of alert, the branch
 * and "open the app". Details are only inside the app after sign-in.
 *
 * Push: Web Push with VAPID keys (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). Without keys,
 *       pushes are skipped and the alert still shows in the app.
 * SMS:  an Egyptian SMS provider the owner signs up for. Any provider with an HTTP API works through
 *       SMS_API_URL (POST, JSON body {to, from, text}), SMS_API_KEY (sent as a Bearer token) and
 *       SMS_SENDER. A provider with another format gets its own class below implementing Notifier.
 *       Without SMS_API_URL (and always in demo mode) SMS are skipped and recorded as such.
 */
export interface OutgoingMessage {
  title: string;
  body: string;
  /** Opened when the person taps the push. */
  url: string;
  /** Critical alerts ask the phone to keep the notification until it is tapped. */
  critical: boolean;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendResult = { status: "sent" | "failed" | "skipped"; detail: string; gone?: string[] };

export interface Notifier {
  readonly channel: "push" | "sms";
  send(to: { phone: string | null; subscriptions: PushTarget[] }, message: OutgoingMessage): Promise<SendResult>;
}

export class WebPushNotifier implements Notifier {
  readonly channel = "push" as const;
  private ready: boolean;
  constructor(env = process.env) {
    const pub = env.VAPID_PUBLIC_KEY;
    const priv = env.VAPID_PRIVATE_KEY;
    this.ready = Boolean(pub && priv);
    if (this.ready) webpush.setVapidDetails(env.VAPID_SUBJECT || "mailto:alerts@example.invalid", pub!, priv!);
  }
  async send(to: { subscriptions: PushTarget[] }, message: OutgoingMessage): Promise<SendResult> {
    if (!this.ready) return { status: "skipped", detail: "push not set up" };
    if (to.subscriptions.length === 0) return { status: "skipped", detail: "no phone" };
    const payload = JSON.stringify(message);
    let sent = 0;
    const gone: string[] = [];
    for (const s of to.subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: message.critical ? 600 : 3600,
          urgency: message.critical ? "high" : "normal",
        });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.endpoint);
      }
    }
    return sent > 0 ? { status: "sent", detail: `${sent} phone(s)`, gone } : { status: "failed", detail: "no phone accepted", gone };
  }
}

export class HttpSmsNotifier implements Notifier {
  readonly channel = "sms" as const;
  constructor(private env = process.env) {}
  async send(to: { phone: string | null }, message: OutgoingMessage): Promise<SendResult> {
    const url = this.env.SMS_API_URL;
    if (this.env.DEMO_MODE === "true") return { status: "skipped", detail: "demo: no SMS" };
    if (!url) return { status: "skipped", detail: "SMS not set up" };
    if (!to.phone) return { status: "skipped", detail: "no phone number" };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.env.SMS_API_KEY ? { Authorization: `Bearer ${this.env.SMS_API_KEY}` } : {}) },
        body: JSON.stringify({ to: toInternational(to.phone), from: this.env.SMS_SENDER ?? "", text: `${message.title}. ${message.body}` }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? { status: "sent", detail: `HTTP ${res.status}` } : { status: "failed", detail: `HTTP ${res.status}` };
    } catch {
      return { status: "failed", detail: "provider unreachable" };
    }
  }
}

/** 01xxxxxxxxx (stored, spec Phase 2) → +201xxxxxxxxx. */
export function toInternational(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("20")) return `+${digits}`;
  if (digits.startsWith("0")) return `+20${digits.slice(1)}`;
  return `+${digits}`;
}

export function notifiers(): Record<"push" | "sms", Notifier> {
  return { push: new WebPushNotifier(), sms: new HttpSmsNotifier() };
}

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}
