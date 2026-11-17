import { getTranslations } from "next-intl/server";
import { Card } from "./ui/Card";
import { StatusChip, type DataStatus } from "./ui/StatusChip";

const ORDER: DataStatus[] = ["verified", "provisional", "incomplete", "notSubmitted", "confirmed"];

/** Legend card explaining the data status chips (spec §6.1, §11.2 item 7). */
export async function StatusLegend() {
  const t = await getTranslations("status");
  return (
    <Card>
      <h2 className="text-section-title font-semibold">{t("legendTitle")}</h2>
      <dl className="mt-3 flex flex-col divide-y divide-divider">
        {ORDER.map((s) => (
          <div key={s} className="flex items-center gap-3 py-2.5">
            <dt className="shrink-0">
              <StatusChip status={s} label={t(s)} />
            </dt>
            <dd className="text-meta text-subtle">{t(`${s}Help`)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
