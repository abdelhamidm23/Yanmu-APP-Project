"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { applyEvent, attendanceSummary, type AttendanceEvent, type AttendanceStatus, type DayRecord } from "@/lib/attendance";
import { enqueue, flush, loadRoom, newUuid, queued, saveRoom } from "@/lib/offline-queue";
import { hashPickupCode, parsePickupQr } from "@/lib/pickup-card";
import { QrScanner } from "./QrScanner";

export interface PickupAdult {
  id: string;
  fullName: string;
  relationship: string;
  photoId: string | null;
  /** SHA-256 of the adult's QR pickup card in use, if they have one. */
  cardHash: string | null;
}

export interface AttendanceChild {
  id: string;
  name: string;
  photoId: string | null;
  day: DayRecord;
  pickup: PickupAdult[];
  hasMedical: boolean;
  medical: { allergies: string | null; conditions: string | null; medications: string | null } | null;
}

interface Snapshot {
  savedAt: string;
  children: Omit<AttendanceChild, "medical">[];
}

/** The phone keeps the room list without medical notes. */
function withoutMedical(c: AttendanceChild): Omit<AttendanceChild, "medical"> {
  const copy: Partial<AttendanceChild> = { ...c };
  delete copy.medical;
  return copy as Omit<AttendanceChild, "medical">;
}

/** Tap times one millisecond apart, so "mark the rest" keeps its order. */
function stamps(count: number): string[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => new Date(now + i).toISOString());
}

function Avatar({ photoId, name, size = 44 }: { photoId: string | null; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
  return photoId ? (
    // eslint-disable-next-line @next/next/no-img-element -- private files served under row-level security
    <img src={`/api/attachment/${photoId}`} alt="" width={size} height={size} className="shrink-0 rounded-full border border-border object-cover" style={{ inlineSize: size, blockSize: size }} />
  ) : (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-tint font-semibold text-brand" style={{ inlineSize: size, blockSize: size }}>
      {initials}
    </span>
  );
}

const time = (iso: string | null, locale: string) =>
  iso ? new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }).format(new Date(iso)) : "";

/**
 * Roll call and check-out for one room on a class phone (spec §8.2, §11.7). Every tap is saved on the
 * phone first and sent when there is a connection, so a weak signal never loses a mark.
 */
export function RoomAttendance({
  roomId,
  date,
  locale,
  initialTab,
  userId,
  items: serverChildren,
}: {
  userId: string;
  roomId: string;
  date: string;
  locale: string;
  initialTab: "rollcall" | "pickup";
  items: AttendanceChild[];
}) {
  const t = useTranslations("attendance");
  const key = `${roomId}|${date}`;
  const [kids, setKids] = useState<AttendanceChild[]>(serverChildren);
  const [tab, setTab] = useState(initialTab);
  const [waiting, setWaiting] = useState(0);
  const [online, setOnline] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [problems, setProblems] = useState<{ name: string; code: string }[]>([]);
  const [excusing, setExcusing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [chosenAdult, setChosenAdult] = useState<string | null>(null);
  const [refusing, setRefusing] = useState(false);
  const [refusalName, setRefusalName] = useState("");
  const [refusalNote, setRefusalNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  /** The adult whose QR card was just scanned, or "unknown" for a card this class does not recognise. */
  const [scanned, setScanned] = useState<PickupAdult | "unknown" | null>(null);
  const namesRef = useRef(new Map<string, string>());
  /** Which child each tap was for, to name the child if the server refuses it. */
  const tapsRef = useRef(new Map<string, string>());

  useEffect(() => {
    namesRef.current = new Map(kids.map((k) => [k.id, k.name]));
  }, [kids]);

  const send = useCallback(async () => {
    const out = await flush(userId);
    if (out.status === "sent") {
      const rejected = out.results.filter((r) => r.result === "rejected");
      if (rejected.length) {
        setProblems((p) => [
          ...p,
          ...rejected.map((r) => ({ name: namesRef.current.get(tapsRef.current.get(r.clientUuid) ?? "") ?? "", code: "code" in r ? r.code : "unknown" })),
        ]);
      }
      // The server's view wins for children whose taps it applied.
      setKids((prev) => prev.map((k) => (out.days[k.id] ? { ...k, day: out.days[k.id] } : k)));
      setOnline(true);
      setSignedOut(false);
    } else if (out.status === "offline") setOnline(false);
    else if (out.status === "signed_out") setSignedOut(true);
    else setOnline(true);
    setWaiting((await queued(userId)).length);
  }, [userId]);

  // On open: keep a copy of the room on the phone, re-apply taps still waiting, then try to send them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let base = serverChildren;
      if (!base.length) {
        const snap = await loadRoom<Snapshot>(key);
        if (snap) base = snap.children.map((c) => ({ ...c, medical: null }));
      } else {
        await saveRoom(key, { savedAt: new Date().toISOString(), children: serverChildren.map(withoutMedical) } satisfies Snapshot);
      }
      const pending = (await queued(userId)).filter((e) => e.date === date);
      const ids = new Set(base.map((c) => c.id));
      const replayed = base.map((c) => {
        let day = c.day;
        for (const ev of pending.filter((e) => e.studentId === c.id)) {
          const r = applyEvent(day, ev);
          if (!("error" in r)) day = r.day;
        }
        return { ...c, day };
      });
      if (!cancelled) {
        // A tap made while this was loading is already on screen and newer: keep it.
        setKids((prev) =>
          replayed.map((c) => {
            const now = prev.find((p) => p.id === c.id);
            return now && (now.day.clientAt ?? "") > (c.day.clientAt ?? "") ? { ...c, day: now.day } : c;
          }),
        );
        setWaiting(pending.filter((e) => ids.has(e.studentId)).length);
      }
      await send();
    })();
    const onOnline = () => void send();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void send(), 20000);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [key, date, serverChildren, send, userId]);

  async function tap(ev: AttendanceEvent) {
    tapsRef.current.set(ev.clientUuid, ev.studentId);
    setKids((prev) =>
      prev.map((k) => {
        if (k.id !== ev.studentId) return k;
        const r = applyEvent(k.day, ev);
        return "error" in r ? k : { ...k, day: r.day };
      }),
    );
    await enqueue({ ...ev, by: userId });
    setWaiting((await queued(userId)).length);
    void send();
  }

  function mark(studentId: string, status: AttendanceStatus, why?: string) {
    void tap({ kind: "mark", clientUuid: newUuid(), at: new Date().toISOString(), studentId, date, status, reason: why });
  }

  function markAllPresent() {
    const at = stamps(kids.filter((k) => k.day.status === null).length);
    kids
      .filter((k) => k.day.status === null)
      .forEach((k, i) => void tap({ kind: "mark", clientUuid: newUuid(), at: at[i], studentId: k.id, date, status: "present" }));
  }

  const summary = useMemo(() => attendanceSummary(kids.map((k) => k.day.status)), [kids]);
  const inRoom = kids.filter((k) => k.day.status === "present" && !k.day.checkOutAt);
  const gone = kids.filter((k) => k.day.checkOutAt);
  const child = kids.find((k) => k.id === checkingOut);

  function confirmCheckout() {
    if (!child || !chosenAdult) return;
    const adult = child.pickup.find((a) => a.id === chosenAdult);
    void tap({ kind: "checkout", clientUuid: newUuid(), at: new Date().toISOString(), studentId: child.id, date, guardianId: chosenAdult });
    setNotice(t("checkedOut", { child: child.name, adult: adult?.fullName ?? "" }));
    setCheckingOut(null);
    setChosenAdult(null);
  }

  async function onScan(text: string) {
    setScanning(false);
    setNotice(null);
    const code = parsePickupQr(text);
    const hash = code ? await hashPickupCode(code) : null;
    const adult = hash ? kids.flatMap((k) => k.pickup).find((a) => a.cardHash === hash) : undefined;
    setScanned(adult ?? "unknown");
  }

  /** Children in the class now whom the scanned adult may collect. */
  const qrChildren = scanned && scanned !== "unknown" ? inRoom.filter((k) => k.pickup.some((a) => a.id === scanned.id)) : [];

  function handOverQr(list: AttendanceChild[]) {
    if (!scanned || scanned === "unknown") return;
    const at = stamps(list.length);
    list.forEach((k, i) => void tap({ kind: "checkout", clientUuid: newUuid(), at: at[i], studentId: k.id, date, guardianId: scanned.id, via: "qr" }));
    setNotice(list.map((k) => t("checkedOut", { child: k.name, adult: scanned.fullName })).join(" "));
    if (list.length === qrChildren.length) setScanned(null);
  }

  function recordRefusal() {
    if (!child) return;
    void tap({ kind: "refusal", clientUuid: newUuid(), at: new Date().toISOString(), studentId: child.id, date, personName: refusalName || undefined, note: refusalNote || undefined });
    setNotice(t("refusalRecorded"));
    setRefusing(false);
    setRefusalName("");
    setRefusalNote("");
    setCheckingOut(null);
  }

  const statusButton = (k: AttendanceChild, s: AttendanceStatus) => {
    const on = k.day.status === s;
    const tone = s === "present" ? "bg-good text-white border-good" : s === "absent" ? "bg-critical text-white border-critical" : "bg-attention text-white border-attention";
    return (
      <button
        type="button"
        aria-pressed={on}
        data-testid={`mark-${s}`}
        disabled={Boolean(k.day.checkOutAt)}
        onClick={() => (s === "excused" ? (setExcusing(k.id), setReason("")) : mark(k.id, s))}
        className={`min-h-12 flex-1 rounded-button border px-2 text-[15px] font-semibold disabled:opacity-50 ${on ? tone : "border-outline bg-surface text-ink"}`}
      >
        {t(`status.${s}`)}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="status" aria-live="polite" data-testid="sync-status" className={`rounded-button px-3.5 py-2.5 text-[14px] ${waiting ? "bg-attention-bg text-attention" : "bg-verified-bg text-verified-fg"}`}>
        {signedOut ? t("signedOut") : waiting ? (online ? t("sending", { count: waiting }) : t("waitingOffline", { count: waiting })) : t("allSent")}
      </div>
      {problems.length ? (
        <Alert>
          {t("rejected")}{" "}
          {problems.map((p, i) => (
            <span key={i}>
              {p.name ? `${p.name}: ` : ""}
              {t.has(`errors.${p.code}`) ? t(`errors.${p.code}` as "errors.unknown") : t("errors.unknown")}{" "}
            </span>
          ))}
        </Alert>
      ) : null}
      {notice ? <Alert tone="good">{notice}</Alert> : null}

      <p className="figure text-meta text-subtle" data-testid="roll-summary">
        {t("summary", { present: summary.present, absent: summary.absent, excused: summary.excused, notMarked: summary.notMarked })}
      </p>

      <div role="tablist" aria-label={t("tabsLabel")} className="grid grid-cols-2 gap-2">
        {(["rollcall", "pickup"] as const).map((x) => (
          <button
            key={x}
            role="tab"
            type="button"
            aria-selected={tab === x}
            data-testid={`tab-${x}`}
            onClick={() => setTab(x)}
            className={`min-h-12 rounded-button text-[15px] font-semibold ${tab === x ? "bg-brand text-white" : "border border-outline bg-surface text-ink"}`}
          >
            {x === "rollcall" ? t("tabRollCall") : t("tabPickup", { count: inRoom.length })}
          </button>
        ))}
      </div>

      {kids.length === 0 ? <Card>{t("noChildren")}</Card> : null}

      {tab === "rollcall" && kids.length ? (
        <>
          {summary.notMarked > 0 ? (
            <Button variant="secondary" onClick={markAllPresent} data-testid="mark-all-present">
              {t("markRestPresent", { count: summary.notMarked })}
            </Button>
          ) : null}
          <ul className="flex flex-col gap-2" data-testid="roll-list">
            {kids.map((k) => (
              <li key={k.id} className="rounded-card border border-border bg-surface p-3" data-testid="roll-row" data-child={k.name}>
                <div className="flex items-center gap-3">
                  <Avatar photoId={k.photoId} name={k.name} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-row-title font-semibold">{k.name}</span>
                    <span className="text-meta text-muted">
                      {k.day.checkOutAt
                        ? t("wentHome", { time: time(k.day.checkOutAt, locale) })
                        : k.day.status
                          ? t(`status.${k.day.status}`) + (k.day.checkInAt ? ` · ${time(k.day.checkInAt, locale)}` : "")
                          : t("notMarked")}
                    </span>
                  </div>
                  {k.hasMedical ? <MedicalBadge medical={k.medical} label={t("medical")} /> : null}
                </div>
                <div className="mt-3 flex gap-2">
                  {statusButton(k, "present")}
                  {statusButton(k, "absent")}
                  {statusButton(k, "excused")}
                </div>
                {excusing === k.id ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <label htmlFor={`reason-${k.id}`} className="text-[13px] font-medium text-subtle">
                      {t("excuseReason")}
                    </label>
                    <input
                      id={`reason-${k.id}`}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]"
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          mark(k.id, "excused", reason);
                          setExcusing(null);
                        }}
                        disabled={reason.trim().length < 2}
                        data-testid="save-excuse"
                      >
                        {t("save")}
                      </Button>
                      <Button variant="secondary" onClick={() => setExcusing(null)}>
                        {t("cancel")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {tab === "pickup" && kids.length ? (
        <>
          {child ? (
            <Card className="flex flex-col gap-3" data-testid="checkout-panel">
              <h2 className="text-section-title font-semibold">{t("whoCollects", { child: child.name })}</h2>
              {child.pickup.length === 0 ? <Alert>{t("noApprovedAdults")}</Alert> : null}
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">{t("approvedAdults")}</legend>
                {child.pickup.map((a) => (
                  <label
                    key={a.id}
                    className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-button border p-2 ${chosenAdult === a.id ? "border-brand ring-2 ring-brand" : "border-outline"}`}
                  >
                    <input type="radio" name="adult" value={a.id} checked={chosenAdult === a.id} onChange={() => setChosenAdult(a.id)} className="size-5" />
                    <Avatar photoId={a.photoId} name={a.fullName} size={56} />
                    <span className="flex flex-col">
                      <span className="font-semibold">{a.fullName}</span>
                      <span className="text-meta text-muted">{t(`relationship.${a.relationship}` as "relationship.other")}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <Button onClick={confirmCheckout} disabled={!chosenAdult} data-testid="confirm-checkout">
                {t("confirmCheckout")}
              </Button>
              {!refusing ? (
                <Button variant="danger" onClick={() => setRefusing(true)} data-testid="not-on-list">
                  {t("notOnList")}
                </Button>
              ) : (
                <div className="flex flex-col gap-2 rounded-button border border-critical p-3" data-testid="refusal-form">
                  <p role="alert" className="font-semibold text-critical">
                    {t("notApproved")}
                  </p>
                  <label htmlFor="refusal-name" className="text-[13px] font-medium text-subtle">
                    {t("personName")}
                  </label>
                  <input id="refusal-name" value={refusalName} onChange={(e) => setRefusalName(e.target.value)} className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]" />
                  <label htmlFor="refusal-note" className="text-[13px] font-medium text-subtle">
                    {t("note")}
                  </label>
                  <input id="refusal-note" value={refusalNote} onChange={(e) => setRefusalNote(e.target.value)} className="min-h-11 rounded-button border border-outline bg-surface px-3 text-[15px]" />
                  <Button variant="danger" onClick={recordRefusal} data-testid="record-refusal">
                    {t("recordRefusal")}
                  </Button>
                </div>
              )}
              <Button
                variant="secondary"
                onClick={() => {
                  setCheckingOut(null);
                  setRefusing(false);
                }}
              >
                {t("cancel")}
              </Button>
            </Card>
          ) : null}
          {scanning ? (
            <Card>
              <QrScanner onResult={(text) => void onScan(text)} onClose={() => setScanning(false)} />
            </Card>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setScanning(true);
                setScanned(null);
                setCheckingOut(null);
              }}
              data-testid="scan-card"
            >
              {t("scanCard")}
            </Button>
          )}
          {scanned === "unknown" ? (
            <div role="alert" className="flex flex-col gap-2 rounded-card border border-critical bg-surface p-4" data-testid="qr-unknown">
              <p className="font-semibold text-critical">{t("qrUnknown")}</p>
              <Button variant="secondary" onClick={() => setScanned(null)}>
                {t("cancel")}
              </Button>
            </div>
          ) : scanned ? (
            <Card className="flex flex-col gap-3 border-good" data-testid="qr-result">
              <div className="flex items-center gap-3">
                <Avatar photoId={scanned.photoId} name={scanned.fullName} size={72} />
                <span className="flex flex-col">
                  <span className="text-meta text-good">{t("qrValid")}</span>
                  <span className="text-row-title font-semibold">{scanned.fullName}</span>
                  <span className="text-meta text-muted">{t(`relationship.${scanned.relationship}` as "relationship.other")}</span>
                </span>
              </div>
              <p className="text-[14px]">{t("qrCheckFace")}</p>
              {qrChildren.length === 0 ? (
                <p className="text-muted" data-testid="qr-none-here">{t("qrNoneHere")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {qrChildren.map((k) => (
                    <li key={k.id} className="flex items-center gap-3 rounded-button border border-border p-2" data-child={k.name}>
                      <Avatar photoId={k.photoId} name={k.name} />
                      <span className="flex-1 font-semibold">{k.name}</span>
                      <Button onClick={() => handOverQr([k])} data-testid="qr-hand-over">
                        {t("handOver")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {qrChildren.length > 1 ? (
                <Button onClick={() => handOverQr(qrChildren)} data-testid="qr-hand-over-all">
                  {t("handOverAll", { count: qrChildren.length })}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setScanned(null)}>
                {t("cancel")}
              </Button>
            </Card>
          ) : null}
          <h2 className="text-section-title font-semibold">{t("inRoom", { count: inRoom.length })}</h2>
          {inRoom.length === 0 ? <p className="text-muted">{t("nobodyIn")}</p> : null}
          <ul className="flex flex-col gap-2" data-testid="pickup-list">
            {inRoom.map((k) => (
              <li key={k.id} className="flex items-center gap-3 rounded-card border border-border bg-surface p-3" data-child={k.name}>
                <Avatar photoId={k.photoId} name={k.name} />
                <span className="flex-1 text-row-title font-semibold">{k.name}</span>
                {k.hasMedical ? <MedicalBadge medical={k.medical} label={t("medical")} /> : null}
                <Button
                  onClick={() => {
                    setCheckingOut(k.id);
                    setChosenAdult(null);
                    setRefusing(false);
                    setNotice(null);
                  }}
                  data-testid="checkout"
                >
                  {t("checkOut")}
                </Button>
              </li>
            ))}
          </ul>
          {gone.length ? (
            <>
              <h2 className="text-section-title font-semibold">{t("wentHomeTitle", { count: gone.length })}</h2>
              <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface" data-testid="gone-list">
                {gone.map((k) => {
                  const adult = k.pickup.find((a) => a.id === k.day.collectedByGuardianId);
                  return (
                    <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[14px]">
                      <span className="font-medium">{k.name}</span>
                      <span className="figure text-muted">{t("collectedBy", { adult: adult?.fullName ?? "—", time: time(k.day.checkOutAt, locale) })}
                        {k.day.checkOutVia === "qr" ? ` · ${t("viaQr")}` : ""}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Allergy and health flag; details open on tap (spec §11.7). Teachers and the branch manager only. */
function MedicalBadge({ medical, label }: { medical: AttendanceChild["medical"]; label: string }) {
  const t = useTranslations("attendance");
  if (!medical) {
    return (
      <span className="inline-flex min-h-8 items-center rounded-chip bg-critical-bg px-2 text-meta font-semibold text-critical" data-testid="medical-flag">
        {label}
      </span>
    );
  }
  return (
    <details className="relative" data-testid="medical-flag">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-chip bg-critical-bg px-3 text-meta font-semibold text-critical">{label}</summary>
      <div className="absolute end-0 z-10 mt-1 w-64 rounded-card border border-border bg-surface p-3 text-[14px] shadow-none">
        {medical.allergies ? (
          <p>
            <strong>{t("allergies")}:</strong> {medical.allergies}
          </p>
        ) : null}
        {medical.conditions ? (
          <p>
            <strong>{t("conditions")}:</strong> {medical.conditions}
          </p>
        ) : null}
        {medical.medications ? (
          <p>
            <strong>{t("medications")}:</strong> {medical.medications}
          </p>
        ) : null}
      </div>
    </details>
  );
}
