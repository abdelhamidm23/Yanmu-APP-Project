import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/Alert";
import { Flag } from "@/components/children/BranchTabs";
import { Link } from "@/i18n/navigation";

/** Outcome of the last safety action (?ok=…&done=… or ?error=…), in plain words. */
export async function SafetyResult({ searchParams }: { searchParams: { ok?: string; done?: string; error?: string } }) {
  const t = await getTranslations("safety");
  if (searchParams.ok) {
    const key = `ok.${searchParams.done ?? "saved"}`;
    return <Alert tone="good">{t.has(key) ? t(key as "ok.saved") : t("ok.saved")}</Alert>;
  }
  if (searchParams.error) {
    const key = `errors.${searchParams.error}`;
    return <Alert>{t.has(key) ? t(key as "errors.unknown") : t("errors.unknown")}</Alert>;
  }
  return null;
}

export async function SeverityFlag({ severity }: { severity: string }) {
  const t = await getTranslations("safety");
  const tone = severity === "critical" ? "critical" : severity === "serious" ? "attention" : "neutral";
  return <Flag tone={tone} testId={`severity-flag-${severity}`}>{t(`severity.${severity}` as "severity.minor")}</Flag>;
}

export async function IncidentStatusFlag({ status }: { status: string }) {
  const t = await getTranslations("safety");
  const tone = status === "closed" ? "good" : status === "under_review" ? "attention" : "neutral";
  return <Flag tone={tone}>{t(`status.${status}` as "status.open")}</Flag>;
}

export async function PriorityFlag({ priority }: { priority: string }) {
  const t = await getTranslations("safety");
  const tone = priority === "urgent" ? "critical" : priority === "high" ? "attention" : "neutral";
  return <Flag tone={tone}>{t(`issues.priority.${priority}` as "issues.priority.normal")}</Flag>;
}

/** Tabs between views of a list (open, closed, all …), keeping the branch. */
export function ViewTabs({ views, current, label, hrefFor, labelFor }: { views: readonly string[]; current: string; label: string; hrefFor: (v: string) => string; labelFor: (v: string) => string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {views.map((v) => (
        <Link
          key={v}
          href={hrefFor(v)}
          aria-current={v === current ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-button px-3 text-[14px] font-medium ${v === current ? "bg-brand text-white" : "border border-outline bg-surface text-ink hover:bg-bg"}`}
          data-testid={`view-${v}`}
        >
          {labelFor(v)}
        </Link>
      ))}
    </nav>
  );
}
