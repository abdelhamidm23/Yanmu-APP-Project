import { getTranslations } from "next-intl/server";
import type { MoneyRequest, TrailStep } from "@/db/money";
import { formatTimestamp, type Digits, type Locale } from "@/lib/format";
import { Flag } from "@/components/children/BranchTabs";

/** Who asked, who recommended, who decided, and every question and answer on the way. */
export async function ApprovalTrail({ request, steps, locale, digits }: { request: MoneyRequest; steps: TrailStep[]; locale: string; digits: Digits }) {
  const t = await getTranslations("money.approval");
  const loc: Locale = locale === "en" ? "en" : "ar";
  const tone = (d: string) => (d === "approve" || d === "recommend_approve" ? "good" : d === "reject" || d === "recommend_reject" ? "critical" : "neutral");
  const where =
    request.status === "pending"
      ? request.stepCount === 2 && request.currentStep === 1
        ? t("atStep1")
        : request.stepCount === 2
          ? t("atStep2")
          : t("atDecider")
      : null;
  return (
    <div className="flex flex-col gap-2" data-testid="approval-trail">
      <div className="flex flex-wrap items-center gap-2">
        {request.status === "approved" ? <Flag tone="good">{t("approved")}</Flag> : null}
        {request.status === "declined" ? <Flag tone="critical">{t("declined")}</Flag> : null}
        {request.status === "question" ? <Flag tone="attention">{t("question")}</Flag> : null}
        {request.status === "pending" ? <Flag tone="attention">{t("waiting")}</Flag> : null}
        {where ? <span className="text-meta text-muted">{where}</span> : null}
      </div>
      <ol className="flex flex-col gap-2 border-s-2 border-divider ps-3 text-[14px]">
        <li>
          <span className="font-medium">{t("asked", { name: request.requestedByName ?? "—" })}</span>
          <span className="block text-meta text-muted">{formatTimestamp(new Date(request.createdAt), loc, digits)}</span>
          {request.reason ? <span className="block text-meta text-subtle">{request.reason.split(",").map((r) => (t.has(`reasons.${r}`) ? t(`reasons.${r}` as "reasons.flagged") : r)).join(" · ")}</span> : null}
        </li>
        {steps.map((s, i) => (
          <li key={i}>
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{s.byName ?? "—"}</span>
              <Flag tone={tone(s.decision)}>{t(`decisions.${s.decision}` as "decisions.approve")}</Flag>
            </span>
            {s.comment ? <span className="block">{s.comment}</span> : null}
            <span className="block text-meta text-muted">{formatTimestamp(new Date(s.at), loc, digits)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
