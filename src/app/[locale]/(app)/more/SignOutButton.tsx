"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/Button";

export function SignOutButton() {
  const t = useTranslations("auth");
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      full
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      {t("signOut")}
    </Button>
  );
}
