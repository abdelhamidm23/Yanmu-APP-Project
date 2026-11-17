import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { appUser, branch, userBranchRole } from "@/db/schema";
import { requireSettings } from "@/lib/require-user";
import { isOwner } from "@/lib/permissions";
import { localName } from "@/lib/i18n-names";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/settings/Fields";
import { ResultBanner } from "@/components/settings/ResultBanner";
import { GrantGrid } from "../GrantGrid";
import { UserDetailsFields } from "../UserDetailsFields";
import { resetMfa, updateUser } from "../actions";
import { ResetPasswordForm } from "./ResetPasswordForm";

export default async function EditUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const me = await requireSettings(locale);
  const t = await getTranslations("settings");
  const data = await withUserDb(me.id, async (tx) => {
    const [u] = await tx.select().from(appUser).where(eq(appUser.id, id));
    if (!u) return null;
    return {
      u,
      grants: await tx.select().from(userBranchRole).where(eq(userBranchRole.userId, id)),
      branches: await tx.select().from(branch).orderBy(asc(branch.code)),
    };
  });
  if (!data) notFound();
  const { u, grants, branches } = data;
  const isSelf = u.id === me.id;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={u.name} />
      <ResultBanner searchParams={await searchParams} />
      <Card>
        <form action={updateUser} className="flex flex-col gap-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={u.id} />
          <UserDetailsFields values={{ name: u.name, email: u.email, phone: u.phone, locale: u.locale, endDate: u.endDate }} withEmail={false} withEndDate={!isSelf} />
          <GrantGrid
            branches={branches.map((b) => ({ id: b.id, name: localName(b, locale) }))}
            selected={grants.map((g) => ({ role: g.role, branchId: g.branchId }))}
            canGrantOwner={isOwner(me)}
            disabled={isSelf}
          />
          {isSelf ? <p className="text-meta text-muted">{t("result.self")}</p> : null}
          <Button type="submit" className="self-start">
            {t("common.save")}
          </Button>
        </form>
      </Card>

      {!isSelf ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-section-title font-semibold">{t("users.tempPassword")}</h2>
          <ResetPasswordForm userId={u.id} />
          <div className="flex flex-col gap-2 border-t border-divider pt-4">
            <h2 className="text-section-title font-semibold">{t("users.mfa")}</h2>
            <p className="text-[14px]" data-testid="user-mfa">
              {u.twoFactorEnabled ? t("users.mfaOn") : t("users.mfaOff")}
            </p>
            {u.twoFactorEnabled ? (
              <form action={resetMfa} className="flex flex-col gap-2">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="id" value={u.id} />
                <p className="text-meta text-muted">{t("users.resetMfaHelp")}</p>
                <Button type="submit" variant="danger" className="self-start">
                  {t("users.resetMfa")}
                </Button>
              </form>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
