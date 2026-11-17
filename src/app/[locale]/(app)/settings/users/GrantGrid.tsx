import { getTranslations } from "next-intl/server";
import { ROLES } from "@/lib/roles";
import { BRANCH_ONLY, ORG_ONLY, grantKey, type Grant } from "./grants";

/** Table of checkboxes: one row per role, one column for "All branches" and each branch. */
export async function GrantGrid({
  branches,
  selected,
  canGrantOwner,
  disabled = false,
}: {
  branches: { id: string; name: string }[];
  selected: Grant[];
  canGrantOwner: boolean;
  disabled?: boolean;
}) {
  const t = await getTranslations();
  const chosen = new Set(selected.map(grantKey));
  const columns = [{ id: "all", name: t("settings.common.allBranches") }, ...branches];
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2">
      <legend className="text-section-title font-semibold">{t("settings.users.roles")}</legend>
      <p className="text-meta text-muted">{t("settings.users.rolesHelp")}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]" data-testid="grant-grid">
          <thead>
            <tr>
              <th scope="col" className="py-2 text-start font-medium text-subtle">
                <span className="sr-only">{t("settings.users.roles")}</span>
              </th>
              {columns.map((c) => (
                <th key={c.id} scope="col" className="px-2 py-2 text-center font-medium text-subtle">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {ROLES.map((role) => (
              <tr key={role}>
                <th scope="row" className="py-1 text-start font-medium">
                  {t(`roles.${role}`)}
                </th>
                {columns.map((c) => {
                  const scope = c.id;
                  const allowed =
                    (scope === "all" ? !BRANCH_ONLY.includes(role) : !ORG_ONLY.includes(role)) && (role !== "owner" || canGrantOwner);
                  const value = `${role}:${scope}`;
                  return (
                    <td key={c.id} className="px-2 text-center">
                      {allowed ? (
                        <label className="inline-flex size-11 items-center justify-center">
                          <input
                            type="checkbox"
                            name="grant"
                            value={value}
                            defaultChecked={chosen.has(value)}
                            className="size-5 accent-brand"
                            aria-label={`${t(`roles.${role}`)} · ${c.name}`}
                          />
                        </label>
                      ) : chosen.has(value) ? (
                        <>
                          {/* Keep grants this person cannot change. */}
                          <input type="hidden" name="grant" value={value} />
                          <span aria-label={`${t(`roles.${role}`)} · ${c.name}`}>✓</span>
                        </>
                      ) : (
                        <span aria-hidden="true" className="text-outline">
                          ·
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}
