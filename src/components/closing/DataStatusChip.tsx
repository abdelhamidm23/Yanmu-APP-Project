import { getTranslations } from "next-intl/server";
import { StatusChip, type DataStatus } from "@/components/ui/StatusChip";

export async function DataStatusChip({ status }: { status: DataStatus }) {
  const t = await getTranslations("status");
  return <StatusChip status={status} label={t(status)} />;
}
