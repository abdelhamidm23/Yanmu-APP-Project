import { expect, test, type Browser, type Page } from "@playwright/test";
import { ownerQuery, resetChildren, signIn } from "./helpers";

/**
 * Phase 3 main flows (spec §8.2, §8.3, §17.1): roll call → check-out to an approved adult,
 * a refused pickup reaching the branch manager, taps made offline, the fingerprint file
 * (preview, row errors, unknown numbers, undo), the roster fixing a ratio breach, and PIN sign-in.
 * Uses the demo children and staff (pnpm seed:demo), reset before the run.
 */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(Date.now() - 86400000));

/** Yanmu Toddlers 1 (the demo teacher's class): no roll call yet today and no refused pickups. */
async function clearTeacherRoom() {
  await ownerQuery(async (sql) => {
    const room = sql`(select r.id from room r join branch b on b.id = r.branch_id where b.code = 'A' and r.name_en = 'Toddlers 1')`;
    await sql`delete from pickup_refusal where student_id in (select student_id from enrollment where room_id in ${room}) and happened_at >= now() - interval '1 day'`;
    await sql`delete from student_attendance where room_id in ${room} and date = ${today}`;
    return [];
  });
}

async function roomDay() {
  return ownerQuery(
    (sql) => sql`
      select a.status, a.check_out_at is not null as gone, s.full_name_en as name
      from student_attendance a join student s on s.id = a.student_id
      join room r on r.id = a.room_id join branch b on b.id = r.branch_id
      where b.code = 'A' and r.name_en = 'Toddlers 1' and a.date = ${today}`,
  );
}

async function newPage(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined });
  const page = await ctx.newPage();
  await signIn(page, email, "en");
  return page;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await resetChildren();
});

test.beforeEach(async () => {
  await clearTeacherRoom();
});

test("roll call, check-out to an approved adult, and a refused pickup reaching the branch manager", async ({ page, browser }) => {
  await signIn(page, "teacher@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/my-class$/);
  await page.goto("/en/roll-call");
  // One room: the list opens straight on it.
  await expect(page).toHaveURL(/\/en\/roll-call\/[0-9a-f-]+$/);
  await expect(page.getByTestId("roll-summary")).toHaveText("Present 0 · Absent 0 · Excused 0 · Not marked 11");

  const rows = page.getByTestId("roll-row");
  await rows.nth(0).getByTestId("mark-absent").click();
  await rows.nth(1).getByTestId("mark-excused").click();
  await rows.nth(1).locator("input").fill("Doctor");
  await rows.nth(1).getByTestId("save-excuse").click();
  await page.getByTestId("mark-all-present").click();
  await expect(page.getByTestId("roll-summary")).toHaveText("Present 9 · Absent 1 · Excused 1 · Not marked 0");
  await expect(page.getByTestId("sync-status")).toHaveText("Everything is saved.");
  await expect.poll(async () => (await roomDay()).length).toBe(11);

  await page.getByTestId("tab-pickup").click();
  await expect(page.getByTestId("tab-pickup")).toHaveText("Pickup (9)");
  const first = page.getByTestId("pickup-list").locator("li").first();
  const child = (await first.getAttribute("data-child"))!;
  await first.getByTestId("checkout").click();
  const panel = page.getByTestId("checkout-panel");
  await expect(panel).toContainText(`Who is collecting ${child}?`);
  await expect(page.getByTestId("confirm-checkout")).toBeDisabled();
  await panel.getByRole("radio").first().check();
  await page.getByTestId("confirm-checkout").click();
  await expect(page.locator("main")).toContainText(`${child} went home with`);
  await expect(page.getByTestId("gone-list")).toContainText(child);
  await expect(page.getByTestId("tab-pickup")).toHaveText("Pickup (8)");

  // Someone not on the list: the app says no and records it.
  await page.getByTestId("pickup-list").locator("li").first().getByTestId("checkout").click();
  await page.getByTestId("not-on-list").click();
  await expect(page.getByTestId("refusal-form")).toContainText("Not approved. Do not hand the child over.");
  await page.locator("#refusal-name").fill("E2E Stranger");
  await page.getByTestId("record-refusal").click();
  await expect(page.locator("main")).toContainText("Refusal recorded.");
  await expect(page.getByTestId("tab-pickup")).toHaveText("Pickup (8)");
  await expect(page.getByTestId("sync-status")).toHaveText("Everything is saved.");
  await expect.poll(async () => (await roomDay()).filter((r) => r.gone).map((r) => r.name)).toEqual([child]);

  const manager = await newPage(browser, "branch.manager@yanmu.test");
  await expect(manager).toHaveURL(/\/en\/today$/);
  const refusals = manager.getByTestId("refusals");
  await expect(refusals).toContainText("E2E Stranger was not allowed to collect");
  await refusals.getByTestId("ack-refusal").click();
  await expect(manager.getByTestId("refusals")).toHaveCount(0);
  await manager.context().close();
});

test("QR pickup card: the branch manager makes one, the teacher scans it and hands the child over", async ({ page, browser }) => {
  const [kid] = await ownerQuery(
    (sql) => sql`
      select s.id, s.full_name_en as name, g.full_name as adult
      from enrollment e join student s on s.id = e.student_id
      join room r on r.id = e.room_id join branch b on b.id = r.branch_id
      join student_guardian sg on sg.student_id = s.id and sg.can_pick_up
      join guardian g on g.id = sg.guardian_id
      where b.code = 'A' and r.name_en = 'Toddlers 1' and e.status = 'active'
      order by s.full_name_en, sg.is_primary_contact desc limit 1`,
  );
  await ownerQuery((sql) => sql`update pickup_card set revoked_at = now() where revoked_at is null and guardian_id in
    (select guardian_id from student_guardian where student_id = ${kid.id as string})`);

  // Branch manager: make the card on the child's record. The code shows once, to print.
  const manager = await newPage(browser, "branch.manager@yanmu.test");
  manager.on("dialog", (d) => void d.accept());
  await expect(manager).toHaveURL(/\/en\/today$/);
  await manager.goto(`/en/children/${kid.id}`);
  const control = manager.getByTestId("pickup-card").first();
  await expect(control.getByTestId("pickup-card-status")).toHaveText("No QR pickup card");
  await control.getByTestId("make-pickup-card").click();
  await expect(control.getByTestId("pickup-card-print")).toContainText(`${kid.adult}`);
  const code = (await control.getByTestId("pickup-card-code").textContent())!.trim();
  expect(code.replace(/\s/g, "")).toMatch(/^[A-Za-z0-9_-]{22}$/);
  await expect(control.getByTestId("pickup-card-status")).toContainText("QR pickup card in use since");

  // Teacher: the child is in class; scanning the card (here: typing its code) offers the hand-over.
  await signIn(page, "teacher@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/my-class$/);
  await page.goto("/en/roll-call");
  await page.getByTestId("mark-all-present").click();
  await expect(page.getByTestId("sync-status")).toHaveText("Everything is saved.");
  await page.getByTestId("tab-pickup").click();
  await page.getByTestId("scan-card").click();
  await page.locator("#qr-typed").fill(code);
  await page.getByTestId("check-typed-code").click();
  const result = page.getByTestId("qr-result");
  await expect(result).toContainText(String(kid.adult));
  await expect(result.locator(`[data-child="${kid.name}"]`)).toHaveCount(1);
  await result.locator(`[data-child="${kid.name}"]`).getByTestId("qr-hand-over").click();
  await expect(page.getByTestId("gone-list")).toContainText(`${kid.name}`);
  await expect(page.getByTestId("gone-list")).toContainText("QR card");
  await expect(page.getByTestId("sync-status")).toHaveText("Everything is saved.");
  const [day] = await ownerQuery(
    (sql) => sql`select check_out_method from student_attendance where student_id = ${kid.id as string} and date = ${today}`,
  );
  expect(day.check_out_method).toBe("qr");

  // A wrong code is refused with a clear warning.
  await page.getByTestId("scan-card").click();
  await page.locator("#qr-typed").fill("not-a-real-card-code-000");
  await page.getByTestId("check-typed-code").click();
  await expect(page.getByTestId("qr-unknown")).toContainText("Do not hand over");

  // Cancelling the card stops it working on the next load of the class.
  await manager.reload();
  await manager.getByTestId("pickup-card").first().getByTestId("cancel-pickup-card").click();
  await expect(manager.getByTestId("pickup-card").first().getByTestId("pickup-card-status")).toHaveText("No QR pickup card");
  await page.reload();
  await page.getByTestId("tab-pickup").click();
  await page.getByTestId("scan-card").click();
  await page.locator("#qr-typed").fill(code);
  await page.getByTestId("check-typed-code").click();
  await expect(page.getByTestId("qr-unknown")).toBeVisible();
  await manager.context().close();
});

test("taps made without a connection are kept on the phone and sent when it returns", async ({ page, context }) => {
  await signIn(page, "teacher@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/my-class$/);
  await page.goto("/en/roll-call");
  await expect(page.getByTestId("sync-status")).toHaveText("Everything is saved.");
  await context.setOffline(true);
  const rows = page.getByTestId("roll-row");
  await rows.nth(0).getByTestId("mark-present").click();
  await rows.nth(1).getByTestId("mark-absent").click();
  await expect(page.getByTestId("sync-status")).toContainText("No connection. 2 taps are saved on this phone");
  await expect(page.getByTestId("roll-summary")).toHaveText("Present 1 · Absent 1 · Excused 0 · Not marked 9");
  expect(await roomDay()).toHaveLength(0);

  await context.setOffline(false);
  await expect(page.getByTestId("sync-status")).toHaveText("Everything is saved.", { timeout: 30_000 });
  expect((await roomDay()).map((r) => r.status).sort()).toEqual(["absent", "present"]);
});

test("fingerprint file: preview with row errors and unknown numbers, save, then undo", async ({ page }) => {
  const [carer] = await ownerQuery(
    (sql) => sql`select s.device_employee_no as no, s.full_name_en as name from staff s join branch b on b.id = s.branch_id
                 where b.code = 'A' and s.is_demo and s.device_employee_no is not null order by s.device_employee_no limit 1`,
  );
  const csv = [
    "Person ID,Name,Time,Device Name",
    `${carer.no},${carer.name},${yesterday} 07:52:10,Entrance`,
    `${carer.no},${carer.name},${yesterday} 07:52:40,Entrance`,
    `${carer.no},${carer.name},${yesterday} 16:20:00,Entrance`,
    `999,E2E Visitor,${yesterday} 10:00:00,Entrance`,
    `,Nobody,${yesterday} 09:00:00,Entrance`,
  ].join("\n");

  // Earlier runs of this test leave nothing behind.
  await ownerQuery(async (sql) => {
    const mine = sql`(select id from import_batch where file_name = 'e2e-fingerprint.csv')`;
    await sql`delete from staff_punch where import_batch_id in ${mine}`;
    await sql`delete from import_batch where id in ${mine}`;
    return [];
  });

  await signIn(page, "branch.manager@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/today$/);
  await page.getByTestId("open-staff-file").click();
  await expect(page).toHaveURL(/\/en\/staff-attendance/);
  await page.locator("#punch-file").setInputFiles({ name: "e2e-fingerprint.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByTestId("punch-check").click();

  const preview = page.getByTestId("punch-preview");
  await expect(preview).toBeVisible();
  await expect(page.getByTestId("map-employeeNo")).toHaveValue("Person ID");
  await expect(page.getByTestId("map-dateTime")).toHaveValue("Time");
  await expect(page.getByTestId("punch-summary")).toContainText(`3 punches from ${yesterday} to ${yesterday}`);
  await expect(preview).toContainText("1 punch is repeated (same person, same minute) and is counted once.");
  await expect(page.getByTestId("punch-errors")).toContainText("Row 6: no employee number");
  await expect(page.getByTestId("punch-unknown")).toContainText("No. 999 (E2E Visitor, 1 punch)");

  await page.getByTestId("punch-commit").click();
  await expect(page.getByTestId("punch-done")).toContainText("3 punches saved.");

  await page.goto(`/en/staff-attendance?date=${yesterday}`);
  const person = page.getByTestId("staff-day").locator("li", { hasText: `No. ${carer.no}` });
  await expect(person).toContainText("In 07:52 · Out 16:20");
  await expect(person).toContainText("On time");

  const batch = page.getByTestId("punch-batches").locator("li", { hasText: "e2e-fingerprint.csv" });
  await batch.getByTestId("undo-file").click();
  await expect(page.getByTestId("punch-batches").locator("li", { hasText: "e2e-fingerprint.csv" })).toContainText("Undone");
  const left = await ownerQuery((sql) => sql`select count(*)::int as n from staff_punch where device_employee_no = '999'`);
  expect(left[0].n).toBe(0);
});

test("a ratio breach shows on Today and the roster fixes it", async ({ page }) => {
  // Norvale Toddlers 1: all 12 children in the room, one of its three carers missing from the fingerprint file.
  const [absent] = await ownerQuery(async (sql) => {
    const room = sql`(select r.id from room r join branch b on b.id = r.branch_id where b.code = 'B' and r.name_en = 'Toddlers 1')`;
    await sql`update student_attendance set status = 'present', check_in_at = coalesce(check_in_at, now()), check_out_at = null, collected_by_guardian_id = null
              where room_id in ${room} and date = ${today}`;
    await sql`delete from room_roster where date = ${today} and staff_id in (select id from staff where default_room_id in ${room})`;
    return sql`select s.id from staff s join staff_attendance_day d on d.staff_id = s.id and d.date = ${today}
               where s.default_room_id in ${room} and d.status = 'absent'`;
  });

  await signIn(page, "branch.manager.b@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/today$/);
  const toddlers = page.getByTestId("today-room").filter({ hasText: "Toddlers 1" });
  await expect(toddlers.getByTestId("ratio-breach")).toHaveText("Ratio broken: 2 carers, 3 needed");
  await expect(page.getByTestId("team-today")).toContainText("1 class is below the ratio");

  await page.getByTestId("open-roster").click();
  const row = page.locator(`li:has(input[name="staffId"][value="${absent.id}"])`);
  await expect(row).toContainText("Absent");
  await row.locator('select[name="present"]').selectOption("yes");
  await row.getByTestId("save-roster").click();
  await expect(page.locator(`li:has(input[name="staffId"][value="${absent.id}"])`)).toContainText("Present (marked)");

  await page.goto("/en/today");
  await expect(page.getByTestId("today-room").filter({ hasText: "Toddlers 1" }).getByTestId("ratio-ok")).toHaveText("Ratio OK: 3 carers, 3 needed");
  // The morning's breach still counts for the day.
  await expect(page.getByTestId("earlier-breaches")).toContainText("Toddlers 1");
});

test("quick PIN sign-in on a shared class phone", async ({ page }) => {
  await signIn(page, "teacher@yanmu.test", "en");
  await expect(page).toHaveURL(/\/en\/my-class$/);
  await page.goto("/en/more");
  await page.locator("#pin").fill("1234");
  await page.locator("#pinAgain").fill("1234");
  await page.getByTestId("save-pin").click();
  await expect(page.locator("main")).toContainText("Use 4 to 6 digits, not all the same and not in a row.");
  await page.locator("#pin").fill("2580");
  await page.locator("#pinAgain").fill("2580");
  await page.getByTestId("save-pin").click();
  await expect(page.locator("main")).toContainText("Quick sign-in is ready on this phone.");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  const quick = page.getByTestId("pin-login");
  await quick.getByRole("button", { name: "Teacher" }).click();
  await page.locator("#quick-pin").fill("1111");
  await page.getByTestId("pin-submit").click();
  await expect(quick).toContainText("Wrong PIN. Try again.");
  await page.locator("#quick-pin").fill("2580");
  await page.getByTestId("pin-submit").click();
  await expect(page).toHaveURL(/\/en\/my-class$/);
});
