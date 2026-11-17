import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { withUserDb } from "@/db/rls";
import { branch } from "@/db/schema";
import { requireSettings } from "@/lib/require-user";
import { isOwner } from "@/lib/permissions";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/settings/Fields";
import { GrantGrid } from "../GrantGrid";
import { UserDetailsFields } from "../UserDetailsFields";
import { NewUserForm } from "./NewUserForm";

export default async function NewUserPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireSettings(locale);
  const t = await getTranslations("settings");
  const branches = await withUserDb(user.id, (tx) => tx.select().from(branch).orderBy(asc(branch.code)));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("users.newUser")} />
      <Card>
        <NewUserForm>
          <UserDetailsFields withEmail withEndDate={false} />
          <GrantGrid branches={branches.map((b) => ({ id: b.id, name: localName(b, locale) }))} selected={[]} canGrantOwner={isOwner(user)} />
        </NewUserForm>
      </Card>
    </div>
  );
}
