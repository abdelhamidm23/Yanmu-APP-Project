import { SectionPlaceholder } from "@/components/SectionPlaceholder";
import { StatusLegend } from "@/components/StatusLegend";
import { requireSection } from "@/lib/require-user";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireSection(locale, "home");
  return (
    <div className="flex flex-col gap-4">
      <SectionPlaceholder section="home" locale={locale === "en" ? "en" : "ar"} digits={user.digits} />
      <StatusLegend />
    </div>
  );
}
