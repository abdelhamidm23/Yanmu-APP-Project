/**
 * Incident short forms waiting on the phone (spec §8.7 "offline-capable", §13). A report made without
 * a connection is kept here and sent when the connection returns, only under the sign-in of the person
 * who wrote it. Sent reports are removed straight away.
 */
"use client";
import type { IncidentDraft } from "./incidents";

const DB_NAME = "yanmu-incidents";
const STORE = "outbox";
export type QueuedIncident = IncidentDraft & { by: string };

let memory: QueuedIncident[] = [];

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "clientUuid" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function queueIncident(item: QueuedIncident) {
  if (!(await openDb())) {
    memory = [...memory.filter((m) => m.clientUuid !== item.clientUuid), item];
    return;
  }
  await tx("readwrite", (s) => s.put(item));
}

export async function queuedIncidents(by: string): Promise<QueuedIncident[]> {
  const all = (await tx<QueuedIncident[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedIncident[]>)) ?? memory;
  return all.filter((i) => i.by === by);
}

async function remove(clientUuid: string) {
  memory = memory.filter((m) => m.clientUuid !== clientUuid);
  await tx("readwrite", (s) => s.delete(clientUuid));
}

export type SendOutcome = { sent: { clientUuid: string; id: string }[]; failed: { clientUuid: string; error: string }[]; offline: boolean };

/** Sends reports to the server. Network trouble leaves them queued; answered ones leave the queue. */
export async function sendIncidents(items: IncidentDraft[]): Promise<SendOutcome> {
  if (items.length === 0) return { sent: [], failed: [], offline: false };
  let res: Response;
  try {
    res = await fetch("/api/incidents/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidents: items.map(({ ...d }) => ({ ...d, by: undefined })) }),
    });
  } catch {
    return { sent: [], failed: [], offline: true };
  }
  if (res.status === 401) return { sent: [], failed: [], offline: true };
  if (!res.ok) return { sent: [], failed: items.map((i) => ({ clientUuid: i.clientUuid, error: "invalid" })), offline: false };
  const body = (await res.json()) as { results: { clientUuid: string; id?: string; error?: string }[] };
  const sent = body.results.filter((r) => r.id).map((r) => ({ clientUuid: r.clientUuid, id: r.id! }));
  const failed = body.results.filter((r) => !r.id).map((r) => ({ clientUuid: r.clientUuid, error: r.error ?? "unknown" }));
  for (const s of sent) await remove(s.clientUuid);
  return { sent, failed, offline: false };
}

/** Sends whatever this person left on the phone. */
export async function flushIncidents(by: string): Promise<SendOutcome> {
  const items = await queuedIncidents(by);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return sendIncidents(items.map(({ by: _by, ...d }) => d));
}
