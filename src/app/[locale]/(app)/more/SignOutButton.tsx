"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/Button";
import { clearOfflineCopies } from "@/lib/offline-queue";

export function SignOutButton() {
  const t = useTranslations("auth");
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      full
      onClick={async () => {
        await authClient.signOut();
        await clearOfflineCopies().catch(() => undefined);
        router.replace("/login");
        router.refresh();
      }}
    >
      {t("signOut")}
    </Button>
  );
}
