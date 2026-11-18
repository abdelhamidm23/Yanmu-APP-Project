/**
 * Offline queue for class phones (spec §8.2, §13 "Service worker + IndexedDB queue").
 * Each tap is stored on the phone first, then sent; taps that cannot be sent stay queued
 * until the connection returns. Only taps and the last room list are kept, never medical notes.
 */
"use client";
import type { AttendanceEvent, DayRecord, EventResult } from "./attendance";


const DB_NAME = "yanmu-offline";
const QUEUE = "queue";
const ROOMS = "rooms";

/** A queued tap remembers who made it, so it is only ever sent under that person's sign-in. */
export type QueuedEvent = AttendanceEvent & { by: string };

let memoryQueue: QueuedEvent[] = [];
const memoryRooms = new Map<string, unknown>();

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "clientUuid" });
        if (!db.objectStoreNames.contains(ROOMS)) db.createObjectStore(ROOMS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        if (!db) return resolve(undefined);
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function enqueue(ev: QueuedEvent): Promise<void> {
  const db = await openDb();
  if (!db) {
    memoryQueue.push(ev);
    return;
  }
  await run(QUEUE, "readwrite", (s) => s.put(ev));
}

/** Taps waiting to be sent, oldest first; only this person's when `by` is given. */
export async function queued(by?: string): Promise<QueuedEvent[]> {
  const db = await openDb();
  const all = db ? (((await run<QueuedEvent[]>(QUEUE, "readonly", (s) => s.getAll() as IDBRequest<QueuedEvent[]>)) ?? []) as QueuedEvent[]) : [...memoryQueue];
  return all.filter((e) => !by || e.by === by).sort((a, b) => a.at.localeCompare(b.at));
}

async function remove(uuids: string[]): Promise<void> {
  if (!uuids.length) return;
  const db = await openDb();
  if (!db) {
    memoryQueue = memoryQueue.filter((e) => !uuids.includes(e.clientUuid));
    return;
  }
  await run(QUEUE, "readwrite", (s) => {
    for (const id of uuids) s.delete(id);
  });
}

/** The last room list loaded, so the room still opens after a reload without a connection. */
export async function saveRoom(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) {
    memoryRooms.set(key, value);
    return;
  }
  await run(ROOMS, "readwrite", (s) => s.put(value, key));
}

export async function loadRoom<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return memoryRooms.get(key) as T | undefined;
  return run<T>(ROOMS, "readonly", (s) => s.get(key) as IDBRequest<T>);
}

/**
 * On sign-out of a shared phone: removes the saved room lists and offline page copies.
 * Taps not yet sent stay, and go out when the same person signs in again.
 */
export async function clearOfflineCopies(): Promise<void> {
  memoryRooms.clear();
  const db = await openDb();
  if (db) await run(ROOMS, "readwrite", (s) => s.clear());
  if (typeof caches !== "undefined") {
    for (const name of await caches.keys()) if (name.startsWith("yanmu-pages")) await caches.delete(name);
  }
}

export type FlushOutcome =
  | { status: "sent"; results: EventResult[]; days: Record<string, DayRecord> }
  | { status: "offline" | "signed_out" | "idle" };

let flushing: Promise<FlushOutcome> | null = null;

function stripBy(e: QueuedEvent): AttendanceEvent {
  const ev: Partial<QueuedEvent> = { ...e };
  delete ev.by;
  return ev as AttendanceEvent;
}

/** Sends every queued tap. Accepted, repeated and outdated taps leave the queue; refused ones are returned to show. */
async function send(by: string): Promise<FlushOutcome> {
  const events = (await queued(by)).map(stripBy);
  if (!events.length) return { status: "idle" };
  let res: Response;
  try {
    res = await fetch("/api/attendance/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: events.slice(0, 300) }),
      cache: "no-store",
    });
  } catch {
    return { status: "offline" };
  }
  if (res.status === 401) return { status: "signed_out" };
  if (!res.ok) return { status: "offline" };
  const body = (await res.json()) as { results: EventResult[]; days: Record<string, DayRecord> };
  await remove(body.results.map((r) => r.clientUuid));
  return { status: "sent", results: body.results, days: body.days };
}

let followUp: Promise<FlushOutcome> | null = null;

/**
 * One send at a time. Taps made while a send is under way go in a single follow-up send
 * as soon as it finishes, rather than waiting for the next timer.
 */
export function flush(by: string): Promise<FlushOutcome> {
  if (flushing) {
    followUp ??= flushing.then(() => {
      followUp = null;
      return flush(by);
    });
    return followUp;
  }
  flushing = send(by).finally(() => {
    flushing = null;
  });
  return flushing;
}

export function newUuid(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  // Older phones (and pages not served over HTTPS): RFC 4122 v4 from getRandomValues.
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
