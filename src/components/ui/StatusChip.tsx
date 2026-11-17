/** Data status chip — docs/SPEC.md §6.1. */
export type DataStatus = "verified" | "provisional" | "incomplete" | "notSubmitted" | "confirmed";

const styles: Record<DataStatus, string> = {
  verified: "bg-verified-bg text-verified-fg",
  confirmed: "bg-verified-bg text-verified-fg",
  provisional: "bg-provisional-bg text-subtle",
  incomplete: "bg-incomplete-bg text-incomplete-fg",
  notSubmitted: "bg-attention-bg text-attention",
};

export function StatusChip({ status, label }: { status: DataStatus; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-chip px-2 py-0.5 text-meta font-medium ${styles[status]}`}
      data-status={status}
    >
      {label}
    </span>
  );
}
