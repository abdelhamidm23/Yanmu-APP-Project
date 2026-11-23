import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { ownerQuery, signIn, signInWithNewMfa } from "./helpers";

/**
 * Phase 5 main flow (spec §17.1): a critical incident is logged by a teacher, reaches every designated
 * person at once, one of them acknowledges it, the report is completed and reviewed, and the owner
 * signs it off. Plus an issue reported and assigned. Incidents the test adds say "E2E" in their text.
 */
test.describe.configure({ timeout: 180_000 });

test.afterAll(async () => {
  await ownerQuery(async (sql) => {
    const ids = sql`(select id from incident where description like 'E2E%')`;
    const alerts = sql`(select id from alert where subject_id in ${ids} or subject_id in (select id from issue where title like 'E2E%'))`;
    await sql`delete from notification_delivery where notification_id in (select id from notification where alert_id in ${alerts})`;
    await sql`delete from notification where alert_id in ${alerts}`;
    await sql`delete from alert where id in ${alerts}`;
    await sql`delete from incident_action where incident_id in ${ids}`;
    await sql`delete from incident_person where incident_id in ${ids}`;
    await sql`delete from incident where id in ${ids}`;
    await sql`delete from issue where title like 'E2E%'`;
    return [];
  });
});

test("critical incident: teacher logs it, everyone is alerted, one acknowledges, the owner signs off", async ({ browser }) => {
  execSync("pnpm -s seed:dev-users --reset", { stdio: "ignore" });
  const teacher = await (await browser.newContext()).newPage();
  await signIn(teacher, "teacher@yanmu.test", "en");
  await teacher.getByTestId("nav-incident").click();
  await expect(teacher).toHaveURL(/\/en\/incidents\/new/);
  await teacher.getByTestId("incident-child").first().check();
  await teacher.getByTestId("incident-category").selectOption("head_injury");
  // Head injuries are always critical: the form says who is alerted.
  await expect(teacher.getByTestId("critical-note")).toBeVisible();
  await teacher.getByTestId("incident-description").fill("E2E fell from the low frame and hit the head.");
  await teacher.getByTestId("incident-action").fill("First aid, kept still, guardian called.");
  await teacher.getByTestId("save-incident").click();
  await expect(teacher).toHaveURL(/\/en\/incidents\/[0-9a-f-]+/);
  const id = teacher.url().match(/incidents\/([0-9a-f-]+)/)![1];
  expect(await teacher.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Everyone designated is told at once: the branch manager of A, the company manager and the owner.
  const told = await ownerQuery((sql) => sql`
    select u.email from notification n join alert a on a.id = n.alert_id join app_user u on u.id = n.user_id
    where a.subject_id = ${id} and a.tier = 'critical'`);
  const emails = told.map((r) => r.email);
  for (const e of ["branch.manager@yanmu.test", "company.manager@yanmu.test", "owner@yanmu.test"]) expect(emails).toContain(e);
  expect(emails).not.toContain("branch.manager.b@yanmu.test");
  // SMS and push carry no names (rule 9): only the kind and the branch.
  const sms = await ownerQuery((sql) => sql`
    select count(*)::int as n from notification_delivery d join notification n on n.id = d.notification_id join alert a on a.id = n.alert_id
    where a.subject_id = ${id} and d.channel = 'sms'`);
  expect(sms[0].n).toBeGreaterThanOrEqual(3);

  // The branch manager sees the red banner on any screen and acknowledges it.
  const bm = await (await browser.newContext()).newPage();
  await signIn(bm, "branch.manager@yanmu.test", "en");
  await expect(bm.getByTestId("critical-banner")).toBeVisible();
  await expect(bm.getByTestId("critical-banner")).not.toContainText("E2E");
  await bm.getByTestId("banner-ack").click();
  await expect(bm.getByTestId("critical-banner")).toHaveCount(0);
  await bm.goto(`/en/incidents/${id}`);
  await expect(bm.getByTestId("alert-acknowledged")).toContainText("Branch manager A");
  // Guardian told, full report written, submitted.
  await bm.locator("#g-when").fill(await bm.evaluate(() => new Date(Date.now() - 5 * 60_000).toLocaleString("sv-SE", { timeZone: "Africa/Cairo" }).slice(0, 16).replace(" ", "T")));
  await bm.locator("#g-note").fill("Mother told by phone.");
  await bm.getByTestId("save-guardian").click();
  await expect(bm.locator("main [role=status]")).toHaveText("Saved.");
  await bm.getByTestId("report-details").fill("The frame mat had moved. Mats now fixed to the floor.");
  await bm.getByTestId("save-report").click();
  await bm.getByTestId("submit-report").click();
  await expect(bm.locator("main [role=status]")).toHaveText("Full report submitted.");

  // The company manager reviews; only the owner may close a critical incident.
  const cm = await (await browser.newContext()).newPage();
  await signInWithNewMfa(cm, "company.manager@yanmu.test", "en");
  await cm.goto(`/en/inbox`);
  await expect(cm.getByTestId("inbox-incidents")).toBeVisible();
  await cm.goto(`/en/incidents/${id}`);
  await cm.getByTestId("mark-reviewed").click();
  await expect(cm.locator("main [role=status]")).toHaveText("Marked reviewed.");
  await expect(cm.getByTestId("close-incident")).toHaveCount(0);

  const owner = await (await browser.newContext()).newPage();
  await signInWithNewMfa(owner, "owner@yanmu.test", "en");
  await owner.goto(`/en/incidents/${id}`);
  await owner.getByTestId("close-incident").click();
  await expect(owner.getByTestId("incident-closed")).toBeVisible();

  // Norvale's branch manager never sees Yanmu's incident.
  const other = await (await browser.newContext()).newPage();
  await signIn(other, "branch.manager.b@yanmu.test", "en");
  await expect(other).toHaveURL(/\/en\/today/);
  await other.goto(`/en/incidents/${id}`);
  await expect(other.getByTestId("incident-summary")).toHaveCount(0);
  await expect(other.locator("body")).not.toContainText("E2E fell");
});

test("an issue is reported, assigned by the branch manager and marked done", async ({ page }) => {
  await signIn(page, "branch.manager@yanmu.test", "ar");
  await expect(page).toHaveURL(/\/ar\/today/);
  await page.goto("/ar/issues/new");
  await page.getByTestId("issue-title").fill("E2E باب الحمام لا يُغلق");
  await page.getByTestId("save-issue").click();
  await expect(page).toHaveURL(/\/ar\/issues\/[0-9a-f-]+/);
  await page.locator("#p-due").fill(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date()));
  await page.getByTestId("plan-issue").click();
  await page.getByTestId("resolve-issue").click();
  await expect(page.getByTestId("issue-status")).toHaveText("انتهت");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
