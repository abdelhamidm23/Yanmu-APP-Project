import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/session";
import { homeSection } from "@/lib/roles";

export default async function LocaleRoot({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });
  if (user.locale !== locale) return redirect({ href: "/", locale: user.locale });
  if (user.mustSetUpMfa) return redirect({ href: "/setup-mfa", locale });
  if (!user.activeRole) return redirect({ href: "/more", locale });
  return redirect({ href: `/${homeSection(user.activeRole)}`, locale });
}
