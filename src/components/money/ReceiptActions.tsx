"use client";
import { useState } from "react";

/**
 * Print the receipt, or make it an image the phone's share sheet can send (WhatsApp, email…).
 * The image is drawn here on the phone; nothing is uploaded anywhere. It carries the account number,
 * not names (rule 9: messages may leave Egypt).
 */
export function ReceiptActions({
  lines,
  fileName,
  labels,
  dir,
}: {
  /** [label, value] rows; the first row is the title. */
  lines: [string, string][];
  fileName: string;
  labels: { print: string; share: string; saved: string };
  dir: "rtl" | "ltr";
}) {
  const [note, setNote] = useState("");

  async function share() {
    const scale = 2;
    const w = 600;
    const rowH = 44;
    const h = 40 + rowH * (lines.length + 1);
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.direction = dir;
    const start = dir === "rtl" ? w - 32 : 32;
    const end = dir === "rtl" ? 32 : w - 32;
    lines.forEach(([label, value], i) => {
      const y = 56 + rowH * i;
      if (i === 0) {
        ctx.font = "bold 22px system-ui, sans-serif";
        ctx.fillStyle = "#111827";
        ctx.textAlign = dir === "rtl" ? "right" : "left";
        ctx.fillText(label, start, y);
        ctx.fillStyle = "#d1d5db";
        ctx.fillRect(32, y + 14, w - 64, 1);
        return;
      }
      ctx.font = "16px system-ui, sans-serif";
      ctx.fillStyle = "#4b5563";
      ctx.textAlign = dir === "rtl" ? "right" : "left";
      ctx.fillText(label, start, y);
      ctx.font = "bold 17px system-ui, sans-serif";
      ctx.fillStyle = "#111827";
      ctx.textAlign = dir === "rtl" ? "left" : "right";
      ctx.fillText(value, end, y);
    });
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return;
    const file = new File([blob], `${fileName}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: lines[0][0] });
        return;
      } catch {
        // Closed the share sheet: fall through to nothing.
        return;
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(a.href);
    setNote(labels.saved);
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button type="button" onClick={() => window.print()} className="min-h-11 rounded-button border border-outline bg-surface px-4 font-medium">
        {labels.print}
      </button>
      <button type="button" onClick={share} className="min-h-11 rounded-button bg-brand px-4 font-medium text-white" data-testid="share-receipt">
        {labels.share}
      </button>
      {note ? <p role="status" className="w-full text-meta text-muted">{note}</p> : null}
    </div>
  );
}
