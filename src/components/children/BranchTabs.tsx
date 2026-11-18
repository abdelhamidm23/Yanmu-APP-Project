import { Link } from "@/i18n/navigation";
import { localName } from "@/lib/i18n-names";

export interface BranchOption {
  id: string;
  nameAr: string;
  nameEn: string;
}

/** Picks the requested branch if visible, otherwise the first one. */
export function pickBranch<B extends { id: string }>(branches: readonly B[], requested: string | undefined): B | null {
  return branches.find((b) => b.id === requested) ?? branches[0] ?? null;
}

/** Branch switcher for people who see more than one branch. Keeps other query values. */
export function BranchTabs({
  branches,
  current,
  path,
  locale,
  label,
}: {
  branches: readonly BranchOption[];
  current: string;
  path: string;
  locale: string;
  label: string;
}) {
  if (branches.length < 2) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2" data-testid="branch-tabs">
      {branches.map((b) => (
        <Link
          key={b.id}
          href={`${path}?branch=${b.id}`}
          aria-current={b.id === current ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-button px-4 text-[14px] font-medium ${
            b.id === current ? "bg-brand text-white" : "border border-outline bg-surface text-ink hover:bg-bg"
          }`}
        >
          {localName(b, locale)}
        </Link>
      ))}
    </nav>
  );
}

/** Small coloured label on a child row. Colour is for status only (spec §12). */
export function Flag({ tone, children, testId }: { tone: "critical" | "attention" | "neutral" | "good"; children: React.ReactNode; testId?: string }) {
  const cls = {
    critical: "bg-critical-bg text-critical",
    attention: "bg-attention-bg text-attention",
    neutral: "bg-provisional-bg text-subtle",
    good: "bg-verified-bg text-verified-fg",
  }[tone];
  return (
    <span data-testid={testId} className={`inline-flex items-center rounded-chip px-2 py-0.5 text-meta font-medium ${cls}`}>
      {children}
    </span>
  );
}
