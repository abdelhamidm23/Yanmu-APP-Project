"use client";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { ALWAYS_CRITICAL, INCIDENT_CATEGORY_KEYS, INCIDENT_SEVERITY_KEYS, type IncidentDraft } from "@/lib/incidents";
import { flushIncidents, queueIncident, queuedIncidents, sendIncidents } from "@/lib/incident-outbox";

type Option = { id: string; name: string };
type Room = Option & { branchId: string };
type Child = Option & { branchId: string; roomId: string };

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/**
 * The incident short form (spec §8.7): class, children, what happened, what was done, how serious.
 * Works without a connection: the report waits on the phone and is sent when the connection returns.
 */
export function IncidentForm({
  userId,
  branches,
  rooms,
  kids: children,
  defaultBranch,
  defaultRoom,
  allowNoRoom,
}: {
  userId: string;
  branches: Option[];
  rooms: Room[];
  kids: Child[];
  defaultBranch: string;
  defaultRoom: string | null;
  allowNoRoom: boolean;
}) {
  const t = useTranslations("safety");
  const router = useRouter();
  const [branchId, setBranchId] = useState(defaultBranch);
  const [roomId, setRoomId] = useState<string>(defaultRoom ?? (allowNoRoom ? "" : rooms.find((r) => r.branchId === defaultBranch)?.id ?? ""));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<string>("injury");
  const [severity, setSeverity] = useState<string>("minor");
  const [told, setTold] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "offline" | "failed">("idle");
  const [queued, setQueued] = useState(0);

  const forced = ALWAYS_CRITICAL.includes(category);
  const shownSeverity = forced ? "critical" : severity;
  const branchRooms = rooms.filter((r) => r.branchId === branchId);
  const shownChildren = useMemo(() => children.filter((c) => c.branchId === branchId && (!roomId || c.roomId === roomId)), [children, branchId, roomId]);

  useEffect(() => {
    let live = true;
    const refresh = () => queuedIncidents(userId).then((q) => live && setQueued(q.length));
    const flush = () =>
      flushIncidents(userId).then(() => refresh());
    refresh();
    flush();
    window.addEventListener("online", flush);
    return () => {
      live = false;
      window.removeEventListener("online", flush);
    };
  }, [userId]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const when = String(fd.get("occurredAt") || localNow());
    const draft: IncidentDraft = {
      clientUuid: crypto.randomUUID(),
      branchId,
      roomId: roomId || null,
      occurredAt: new Date(when).toISOString(),
      category: category as IncidentDraft["category"],
      severity: shownSeverity as IncidentDraft["severity"],
      description: String(fd.get("description") ?? ""),
      immediateAction: String(fd.get("immediateAction") ?? ""),
      studentIds: Array.from(picked),
      guardianTold: told,
      guardianNote: told ? String(fd.get("guardianNote") ?? "") || null : null,
    };
    setState("sending");
    const out = await sendIncidents([draft]);
    if (out.offline) {
      await queueIncident({ ...draft, by: userId });
      setQueued((await queuedIncidents(userId)).length);
      setState("offline");
      return;
    }
    if (out.sent[0]) {
      router.push(`/incidents/${out.sent[0].id}?ok=1&done=created`);
      return;
    }
    setState("failed");
  }

  const control = "min-h-11 w-full rounded-button border border-outline bg-surface px-3 text-[15px] text-ink";
  const label = "text-[13px] font-medium text-subtle";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="incident-form">
      {queued > 0 ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-attention-border bg-attention-bg p-3 text-[14px] text-attention">
          <span>{t("form.queued", { count: queued, n: String(queued) })}</span>
          <button type="button" className="min-h-11 rounded-button border border-outline bg-surface px-3 font-medium text-ink" onClick={() => flushIncidents(userId).then(async () => setQueued((await queuedIncidents(userId)).length))}>
            {t("form.sendNow")}
          </button>
        </div>
      ) : null}
      {state === "offline" ? <p role="status" className="rounded-card bg-attention-bg p-3 text-[14px] text-attention" data-testid="incident-offline">{t("form.offlineSaved")}</p> : null}
      {state === "failed" ? <p role="alert" className="rounded-card bg-critical-bg p-3 text-[14px] text-critical">{t("form.failed")}</p> : null}

      {branches.length > 1 ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="inc-branch" className={label}>{t("branch")}</label>
          <select id="inc-branch" className={control} value={branchId} onChange={(e) => { setBranchId(e.target.value); setRoomId(""); setPicked(new Set()); }}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="inc-room" className={label}>{t("form.class")}</label>
        <select id="inc-room" name="roomId" className={control} value={roomId} onChange={(e) => { setRoomId(e.target.value); setPicked(new Set()); }} required={!allowNoRoom}>
          {allowNoRoom ? <option value="">{t("form.noClass")}</option> : null}
          {branchRooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className={label}>{t("form.children")}</legend>
        <p className="text-meta text-muted">{t("form.childrenHelp")}</p>
        {shownChildren.length === 0 ? (
          <p className="text-[14px] text-muted">{t("form.noChildren")}</p>
        ) : (
          <ul className="mt-1 grid max-h-72 grid-cols-1 gap-1 overflow-y-auto rounded-button border border-border p-2 sm:grid-cols-2">
            {shownChildren.map((c) => (
              <li key={c.id}>
                <label className="flex min-h-11 items-center gap-3 rounded-button px-2 text-[15px] hover:bg-bg">
                  <input
                    type="checkbox"
                    className="size-5 accent-brand"
                    checked={picked.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      setPicked(next);
                    }}
                    data-testid="incident-child"
                  />
                  <span>{c.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="inc-category" className={label}>{t("form.category")}</label>
        <select id="inc-category" className={control} value={category} onChange={(e) => setCategory(e.target.value)} data-testid="incident-category">
          {INCIDENT_CATEGORY_KEYS.map((c) => <option key={c} value={c}>{t(`category.${c}`)}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="inc-desc" className={label}>{t("form.description")}</label>
        <textarea id="inc-desc" name="description" required minLength={3} maxLength={4000} rows={3} className={`${control} py-2`} data-testid="incident-description" />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="inc-action" className={label}>{t("form.action")}</label>
        <textarea id="inc-action" name="immediateAction" required minLength={2} maxLength={4000} rows={2} className={`${control} py-2`} data-testid="incident-action" />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={label}>{t("form.severity")}</legend>
        {INCIDENT_SEVERITY_KEYS.map((s) => (
          <label
            key={s}
            className={`flex min-h-11 items-start gap-3 rounded-button border p-3 ${shownSeverity === s ? (s === "critical" ? "border-critical bg-critical-bg" : "border-brand bg-brand-tint") : "border-border bg-surface"}`}
          >
            <input
              type="radio"
              name="severity"
              value={s}
              className="mt-1 size-5 accent-brand"
              checked={shownSeverity === s}
              disabled={forced && s !== "critical"}
              onChange={() => setSeverity(s)}
              data-testid={`severity-${s}`}
            />
            <span className="flex flex-col">
              <span className={`font-semibold ${s === "critical" ? "text-critical" : ""}`}>{t(`severity.${s}`)}</span>
              <span className="text-meta text-muted">{t(`severityHelp.${s}`)}</span>
            </span>
          </label>
        ))}
        {shownSeverity === "critical" ? <p className="text-[14px] font-medium text-critical" data-testid="critical-note">{t("form.criticalNote")}</p> : null}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="inc-when" className={label}>{t("form.when")}</label>
        <input id="inc-when" name="occurredAt" type="datetime-local" defaultValue={localNow()} max={localNow()} className={control} />
      </div>

      <label className="flex min-h-11 items-center gap-3 text-[15px]">
        <input type="checkbox" className="size-5 accent-brand" checked={told} onChange={(e) => setTold(e.target.checked)} />
        <span>{t("form.guardianTold")}</span>
      </label>
      {told ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="inc-gnote" className={label}>{t("form.guardianNote")}</label>
          <textarea id="inc-gnote" name="guardianNote" maxLength={2000} rows={2} className={`${control} py-2`} />
        </div>
      ) : null}

      <button
        type="submit"
        disabled={state === "sending"}
        className={`min-h-12 w-full rounded-button px-4 text-[15px] font-semibold text-white disabled:opacity-60 ${shownSeverity === "critical" ? "bg-critical" : "bg-brand hover:bg-brand-hover"}`}
        data-testid="save-incident"
      >
        {state === "sending" ? t("form.saving") : t("form.save")}
      </button>
    </form>
  );
}
