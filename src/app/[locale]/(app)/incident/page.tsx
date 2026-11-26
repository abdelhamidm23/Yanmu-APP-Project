import { redirect } from "@/i18n/navigation";
import { requireSection } from "@/lib/require-user";

/** The teacher's "+ Incident" tab (spec §11.1) opens the short form. */
export default async function IncidentTab({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSection(locale, "incident");
  redirect({ href: "/incidents/new", locale });
}
