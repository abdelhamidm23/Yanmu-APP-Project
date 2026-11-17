import { notFound } from "next/navigation";
import { SectionPlaceholder } from "@/components/SectionPlaceholder";
import { requireSection } from "@/lib/require-user";
import { SECTIONS, type Section } from "@/lib/roles";

export default async function SectionPage({ params }: { params: Promise<{ locale: string; section: string }> }) {
  const { locale, section } = await params;
  if (!(SECTIONS as readonly string[]).includes(section)) notFound();
  const user = await requireSection(locale, section);
  return <SectionPlaceholder section={section as Section} locale={locale === "en" ? "en" : "ar"} digits={user.digits} />;
}
