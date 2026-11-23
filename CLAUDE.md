# Nursery Command Center — instructions for Claude

The full product specification is in [`docs/SPEC.md`](docs/SPEC.md). Read Section 0 before any work and the section for the feature you are building. When this file and the spec disagree, the spec wins and this file should be fixed.

## Who we work for

The owner (Khaled) is **not technical**.

- After every phase, write a short plain-language summary: what was built, how to try it on a phone, and any decision needed. No jargon.
- When the owner must run a command or sign up for something, give exact copy-paste steps and say what they should see.
- **Stop at the end of each phase** (spec §18) and wait for the owner's go-ahead before starting the next.
- Ask before anything hard to undo: deleting data, changing the schema after real data exists, deploying to production, spending money.
- Never sign up for paid services or enter payment details. The owner creates hosting and SMS accounts; we write the setup steps.
- Where spec §3 lists an open item, **build the stated default and make it a setting**. Do not block on it.
- Work on a branch and open a pull request. Never push to `main` directly.

## Non-negotiable rules (spec §0.3)

1. **Missing data is never zero.** Every figure carries a data status (spec §6.1). A value nobody entered shows as "—" with who has not submitted.
2. **Never invent figures.** Demo data exists only in demo mode, flagged everywhere (spec §16).
3. **Permissions are enforced on the server and in the database** (PostgreSQL row-level security), never only by hiding buttons.
4. **Branch isolation:** a user sees only branches they hold a role in. Tested automatically on every change.
5. **Money is stored as integer piastres** (EGP × 100) in `bigint` columns. No floats for money, ever.
6. **Finance is append-only.** Posted invoices, payments, expenses and credit notes are never edited or deleted; corrections are reversal entries.
7. **Everything is audited:** who, when, before, after — via database triggers into `audit_event`.
8. **Arabic and English from day one**, with full RTL. Use CSS logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`) — never `left`/`right` for layout.
9. **No child names, health details or personal data in push notifications, SMS, WhatsApp, emails or error-monitoring payloads.** Those routes may leave Egypt.
10. **All personal data stays on servers in Egypt** (spec §15). Do not add any third-party service that stores personal data abroad without asking.
11. Times stored in UTC, shown in `Africa/Cairo`.
12. Touch targets ≥ 44 px; text contrast ≥ 4.5:1.
13. Every list can be exported to Excel; every import has preview, row-level errors and one-step rollback.

## Definition of done for any feature (spec §0.4)

- Works in Arabic (RTL) and English on a 390 px-wide phone and on desktop.
- Server-side permission check + RLS policy + automated test proving another branch cannot read or write it.
- Audit entries are written.
- Loading, empty, error and "not submitted" states are designed, not blank.
- Unit tests for any calculation; one end-to-end test for the main flow.

## Stack (spec §13)

Next.js 16 (App Router) + TypeScript · Tailwind CSS 4 (logical properties) · next-intl (`/ar/…`, `/en/…`, `dir` on `<html>`) · PostgreSQL 16 + Drizzle ORM with SQL migrations in `drizzle/` · Better Auth (database sessions, TOTP two-factor) · Vitest · Playwright + axe · Docker Compose for development.

## Where things are

| Path | What |
| --- | --- |
| `src/app/[locale]/` | Screens. `(app)/` = signed-in screens with the bottom nav. |
| `src/lib/roles.ts` | Roles, per-role navigation (spec §11.1), which roles need MFA. The server checks this on every page. |
| `src/lib/require-user.ts` | Server gate: signed in → MFA set up if privileged → section allowed for role, else 404. |
| `src/lib/auth.ts` | Better Auth config (12 h sessions, TOTP, rate limits, no self sign-up). |
| `src/lib/format.ts` | Piastres ↔ EGP, Arabic/Latin digits, Cairo time. |
| `src/db/schema.ts` | Drizzle schema. After changing it run `pnpm db:generate` and commit the SQL. |
| `drizzle/0002_phase1_rls_audit.sql` | Hand-written: the `yanmu_app` role, RLS helper functions, policies, audit and `updated_at` triggers, `is_working_day()`. |
| `src/db/rls.ts` | `withUserDb(userId, fn, { reason })`: every app query runs inside it so RLS knows who is asking. |
| `src/lib/settings.ts` | Every adjustable threshold (spec §17.3) with its default and validation. |
| `src/lib/permissions.ts` | Server-side permission checks that mirror the RLS policies. |
| `src/messages/{ar,en}.json` | All UI text. Arabic is written, not machine-translated. Keys must match (unit-tested). |
| `src/app/globals.css` | Design tokens from spec §12. Colour is for status only; no gold, gradients or shadows. |
| `scripts/` | `migrate.ts`, `seed-base.ts` (organization, branches, age bands, setting defaults), `seed-dev-users.ts` (dev only), `check-logical-css.ts` (rule 8). |
| `tests/unit/`, `tests/db/`, `e2e/` | Vitest unit tests; database tests for RLS and audit (`pnpm test:db`); Playwright tests on a 390 px phone and desktop. |

## Commands

```bash
pnpm install
pnpm db:setup            # migrations + base data (needs MIGRATION_DATABASE_URL, APP_DB_PASSWORD)
pnpm seed:dev-users      # one test account per role (dev only)
pnpm dev                 # http://localhost:3000
pnpm lint && pnpm lint:rtl && pnpm typecheck && pnpm test   # fast checks
pnpm test:db             # RLS / branch isolation / audit (needs the database)
pnpm test:e2e            # end-to-end (starts the dev server; resets test accounts)
```

`docker compose up` runs Postgres and the app together.

## Conventions

- Every new screen: add its section to `SECTIONS` and the role's `NAV_BY_ROLE` entry (or gate it with `requireSection`), plus `nav.*` and `sections.*` in both message files.
- `pnpm lint:rtl` fails on physical `left`/`right` classes or CSS. Use `ms-/me-/ps-/pe-/start-/end-`. A line may opt out with a `rtl-ok` comment only when it is genuinely direction-independent.
- Use real `<button>`, `<a>`, `<label>`; icon-only buttons need `aria-label`.
- Figures use the `figure` class (tabular numbers). Format money with `formatPiastres`, never with floats.
- Never log or send personal data to services outside Egypt (rules 9 and 10). Next.js telemetry is disabled in Docker and CI.
- **Database access.** The app connects as `yanmu_app` (no ownership, no BYPASSRLS). Run every query through `withUserDb(user.id, tx => …)`; without it RLS returns nothing. Pass `{ reason }` for changes worth explaining in the audit log.
- **Every new table** needs, in a hand-written migration: `ENABLE ROW LEVEL SECURITY`, policies for each action the app may take, `GRANT`s to `yanmu_app`, the `audit_row()` trigger, and (if it has `branch_id`) a case in `tests/db/rls.test.ts` proving another branch cannot read or write it. Add it to `src/db/audit-tables.ts` and `settings.audit.tables.*`.
- Server actions return to the page with `?ok=1` or `?error=<code>` via `runAndReturn`. Never put secrets (like temporary passwords) in a URL.
- Message keys must not contain dots; next-intl treats a dot as nesting (unit-tested).

## Phase 0 decisions and open points

- Sign-in is by email + password. MFA (authenticator app) is enforced for owner, company manager, accountant and HR (spec §14). Per-person PIN on shared class phones arrived in Phase 3.
- `/` always opens Arabic. The language chosen on the sign-in screen (or in More) is saved per person.
- HR is not in the spec §11.1 nav table; its shell is Staff · Attendance · More until the owner decides.

## Phase 1 decisions

- Branches are Yanmu (code A) and Norvale (code B), named by the owner. Codes A/B stay as the short codes in student and family numbers; names can be changed in Settings → Branches.
- Settings (users, branches, classes, age bands, thresholds, audit log) are for the owner and company manager. Branch managers manage holidays for their own branch. Only the owner can grant the owner role; nobody changes their own roles.
- The weekly working days are organization-wide (default Sunday–Thursday); holidays and extra working days are per branch.
- Ending a user's access (end date) signs them out everywhere. Password and two-step resets also sign the person out.

## Phase 2 decisions

- Children screens live under `/children` (list, `new`, `[id]`, `waitlist`, `approvals`, `import`). Access is by role grants (`requireChildren`), not only the active role's tabs; owner, company manager and accountant reach them from More.
- Who sees and edits children is in `drizzle/0004_phase2_children_rls.sql`: viewers = owner, company manager, branch manager, front desk, accountant; editors = branch manager and front desk; imports and their rollback = company manager; teachers see only children with an active enrollment in a class assigned to them (Settings → Users → classes).
- Medical notes: branch manager edits, the child's teachers read. Owner and company manager read only through `app_break_glass_medical(student, reason)`, which writes an audit row. Medical text never enters the audit log (stored as a fingerprint).
- Licence cap (D11) is enforced by a trigger. Past the cap the child is saved as `pending_approval` with an `over_capacity` request; only the owner decides (`app_decide_over_capacity`), and nobody decides their own request.
- Transfers: the sending branch asks; the receiving branch manager accepts with a class (`app_decide_transfer`). If brothers or sisters stay, the family account and this child's guardians are copied to the new branch.
- Age rules: enrollment from 3 months to under 54 months (checked for start dates from today); a class of another age band needs a written reason. Past enrollments from imports are not age-checked at the start date.
- Withdrawal closes the enrollment at once with its last day and reason; refunds of unused days come with Phase 4 (credit notes).
- Photos and signed forms are stored in the database (`attachment`, up to 5 MB) so they stay with the data in Egypt, served through `/api/attachment/[id]` under RLS.
- Phone numbers are stored as 11-digit Egyptian mobiles (`normalizePhone`).
- `pnpm seed:demo` / `pnpm seed:wipe-demo`: made-up children for demo mode (spec §16 figures). E2E tests reset them with `resetChildren()`; children the tests add are named "E2E …".

## Phase 3 decisions

- Screens: `/roll-call` (class list, one class opens straight away), `/roll-call/[roomId]`, `/my-class` (the teacher's class, pickup tab first), `/today` and `/today/roster` (branch manager; front desk sees attendance without ratios), `/staff` (HR edits; branch manager, owner, company manager and accountant read) and `/staff-attendance` (fingerprint file upload, branch manager and HR). Who may do what is in `drizzle/0006_phase3_attendance_rls.sql`.
- Roll call works offline: each tap is stored on the phone (IndexedDB, `src/lib/offline-queue.ts`) and sent to `/api/attendance/sync`. `clientUuid` makes a resend harmless; the tap's own time decides which of two taps wins. Taps are only ever sent under the sign-in of the person who made them. The service worker (`public/sw.js`, production only) keeps the roll-call pages; medical notes are never stored on the phone.
- Check-out only to an adult with "can pick up" on the child's record, enforced by a database trigger. "Not on the list" records a `pickup_refusal`, which the branch manager sees and acknowledges on Today. Children still in after the after-school time (see the owner's review below) show as an alert.
- Today's attendance figure is present ÷ (present + absent): children not marked yet are not counted as absent (rule 1); the roll-call line says how many classes are done.
- Ratio: required carers = ceil(children in the class ÷ the age band's children per staff). A carer counts once confirmed: the manager's tap on the roster wins, otherwise a fingerprint day of present or late. Not confirmed but rostered is "not confirmed", not a breach. `app_take_ratio_snapshot` records the figures after roll call, roster changes and file uploads, only when they change; Today also lists classes that fell short earlier in the day.
- Fingerprint file (open item F7): any Hikvision export in .xlsx or .csv. Columns are guessed from English or Arabic titles, confirmed by the person and remembered per branch (`import_mapping`). Times are read as Cairo wall clock. Unknown machine numbers can be linked to a person during the upload. Late = first punch after the shift start plus `staff_attendance.grace_minutes` (default 10). Nobody is marked absent today before their shift and grace have passed. Undo removes the file's punches and works the days out again.
- Quick PIN sign-in (spec §14): a person sets a 4–6 digit PIN in More on a shared phone; the phone keeps a token per person (up to 12). Five wrong PINs make the phone forget that person. These sessions end after 30 minutes without use. Not offered to roles that need two-step sign-in.
- Demo (`scripts/seed-demo-attendance.ts`): staff and today's attendance reproduce spec §16; run again on a later day it fills that day. In demo mode the upload card offers a made-up fingerprint file.

## Owner's review of phases 0 to 3 (2026-11-19)

- **"Class", never "room"**, in Arabic (فصل) and English UI text and docs. The database keeps `room`/`room_id`; the teacher's screen is `/my-class`. In Arabic, terms of the academic year are "ترم" so they do not clash with "فصل".
- **More is grouped:** Daily work · Nursery setup (branches and classes, age bands, calendar and hours, thresholds) · People and access (users) · Records (audit log) · My account. The groups live in `src/components/settings/SettingsMenu.tsx`, shared with `/settings`.
- **Classes:** Yanmu 6 (Babies 1, Toddlers 1, Juniors 1, Juniors 2, Seniors 1, Seniors 2; "Toddlers 2" was renamed "Juniors 2" on 2026-11-22), Norvale 8 (`scripts/seed-demo.ts` PLAN). **Arabic class and age-group names are the English names in Arabic letters** (بيبيز، تودلرز، جونيورز ٢، سينيورز), not translations (owner, 2026-11-22). `pnpm seed:demo` rebuilds the demo by itself when the classes or their demo children no longer match PLAN, so an old demo database picks up a new layout on the next start.
- **Hours:** Sunday–Thursday, `attendance.opening_time` 08:00, `attendance.closing_time` 16:00, `attendance.after_school_minutes` 60. Edited on Settings → Calendar and hours (owner and company manager). The "still checked in" alert on Today starts when the after-school time ends (17:00).
- **"Daily attendance", not "Roll call"** (owner, 2026-11-22): the screen is labelled "Daily attendance" / "الحضور اليومي" (tab "Attendance" / "الحضور"). The route stays `/roll-call` and the message keys keep their names. The children import template's column is "Class" (an old "Room" column is still read).
- **QR pickup is out of scope for now** (owner, 2026-11-22): parents already use a separate app that gives each child a new pickup code every day, and the admin team scans it there. Check-out in this app is by the approved-adults list only. A QR version was built and then removed on the review branch; `drizzle/0007_remove_qr_pickup.sql` cleans any database that ran it. The code is in the git history (commit 954790a) if the owner asks for it later.


## Phase 4 decisions (money)

- Screens: `/money` (the accountant's first tab: billed, collected, overdue by age, late fees, today), `/invoices` (views: open, overdue families, late fees today, all) and `/invoices/[id]` (lines, payments, credit notes, waiver/correction/refund requests), `/invoices/run` (preview then issue a month), `/payment` (find the family → statement → record), `/payments` and `/payments/[id]` (receipt, print, share as picture, void), `/cash-box`, `/expenses` (`new`, `[id]`), `/inbox` (approvals), and Settings → Money: `/settings/fees`, `/settings/price-locks`, `/settings/expenses`. Who may do what is in `drizzle/0009_phase4_money_rls.sql`, `0010_money_for_accountant.sql` and `0011_money_owner_cm_accountant.sql`, mirrored in `src/lib/permissions.ts`: money figures for the owner, company manager and accountant; payments, cash box, invoice run and credit notes by the accountant; voids by the accountant or company manager (never the person who took the payment); expenses recorded by branch manager and accountant; prices and legacy prices by owner and company manager; decisions by owner and company manager.
- **Money is for the accountant, the owner and the company manager** (owner, 2026-11-23). The front desk and the branch manager see no amounts, take no payments, have no cash box and cannot request credit notes or waivers. "Who paid" (`/paid`, the front desk's tab; the branch manager opens it from Today and More) lists each family as paid, not paid yet, late (with the due date) or no bill yet, from `app_family_pay_status`, which returns no amounts. The branch manager still records the branch's expenses (sent for approval when unusual) and sees them.
- GET search forms must post to `/${locale}/…`: a bare path is redirected to Arabic (owner saw an English search switch to Arabic).
- Every money change runs through the database: numbering (`app_next_doc_no`, gap-free per branch, kind and year), allocation limits, voids (`app_void_payment`: a reason and a second person), credit notes and approvals (`app_decide_money`), closing the cash box (`app_close_cash_session`), late fees (`app_accrue_late_fees`). The app role can never update or delete posted invoices, payments, allocations, credit notes or expenses (rule 6).
- A payment pays the oldest tuition first, then late fees; anything extra stays as credit on the family (`allocate` in `src/lib/billing.ts`).
- Approvals (spec §8.6): up to `approvals.branch_manager_limit_piastres` (EGP 20,000) the company manager or owner decides; above it the company manager recommends and the owner decides. Nobody decides their own request; a question goes back to the person who asked. Rejections stay visible with their reason.
- Expenses are routine when the category is ticked for the branch, the amount is not above the limit, and not more than `approvals.unusual_multiplier` (2×) the category's 3-month average (once there are 3 months of history). Anything else, or anything the person marks unusual, waits for approval. Receipt photo needed from `expenses.photo_required_from_piastres` (EGP 100). "Ask before spending" requests get their receipt after approval. A mistake is cancelled with a reversal entry.
- Late fees: `late_fee.daily_piastres` (EGP 500) per working day a tuition invoice stays unpaid after its due date, kept on a separate late-fee invoice (other income). They add up fast; the amount, a cap and per-invoice or per-family basis are settings. A waiver is a credit note on the late-fee invoice, for all or part of it. **Owner (2026-11-22): EGP 500 per working day is the most, with no cap; management reduces or waives it case by case through approval** (`late_fee.cap_piastres` stays empty).
- Cash box: opened each working day with a float (suggested from the last count), closed with the handover and the count; the difference shows on the cash box page and on Today when above `cash.variance_alert_piastres` (EGP 200) until the accountant marks it checked.
- Receipts can be shared as a picture from the phone. The picture carries the account number, not names (rule 9).
- Demo documents (demo families) are numbered with their own sequence and a `DEMO-` prefix, so the real numbering stays gap-free. `pnpm seed:demo` builds 3 months of demo money; `pnpm seed:wipe-demo` removes it.
- **Daily jobs** (`pnpm jobs`): issues the month's invoices from `billing.invoice_day` once `billing.preview_until` has passed, and adds the day's late fees, for every branch. On the server it must be scheduled with cron, for example at 00:30 and 09:05 Cairo time. Screens that show money also add today's late fees when opened. Children who start mid-month are picked up by the next run (pro-rated by working days when `billing.prorate_new_starts` is on).
- The audit log policies wrap their role checks in a sub-select so PostgreSQL works them out once per query; money adds about a thousand audit rows a day.

## Phase 5 decisions (safety and operations)

- Screens: `/incident` (the teacher's four-field form, works offline through `/api/incidents/sync`), `/incidents` (open, critical, closed, all; Excel export), `/incidents/[id]` (summary, alerts with "I'm on it", people, guardian told, report and photos, actions, progress: seen → report → review → close, and the owner's sign-off for critical ones), `/issues`, `/issues/new`, `/issues/[id]` (managers assign, set the due date and priority), `/inbox` (alerts, incidents waiting for review or sign-off, overdue actions, money approvals for those who decide them, months to reopen for the owner). Rules in `drizzle/0012_phase5_safety.sql` and `0013_phase5_safety_rls.sql`.
- Alerts (spec §10) live in the database: `alert`, one `notification` per person, one `notification_delivery` per push or SMS. A critical incident alerts the branch manager, company manager, owner and the safeguarding leads at once and repeats every `alerts.critical_repeat_minutes` until someone taps "I'm on it". Same-day alerts climb a step at a time (branch manager → company manager after 30 min → owner after 2 h). `app_run_alerts()` is the job; the server runs it every minute (`src/instrumentation.ts`, `ALERTS_TICK=off` stops it).
- Push and SMS carry only the kind of alert and the branch, never names or health details (rule 9). Push needs VAPID keys; SMS needs an Egyptian provider the owner signs up for (`SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER`). Without them, and always in demo mode, they are skipped and the alert still shows in the app (bell, red banner, inbox).
- The reporter of an incident does not get the red banner for their own report.

## Phase 6 decisions (closing and figures)

- Screens: `/daily-close?branch=&date=` (branch manager or company manager closes; owner and accountant read; linked from Today and More), `/month-close?branch=&month=` (the accountant's tab; owner and company manager read; the owner reopens), `/figures` (every figure with its data status, per branch or "All branches"; money figures only for owner, company manager and accountant). Rules in `drizzle/0015_phase6_closing_rls.sql`, mirrored in `src/lib/permissions.ts` (`canCloseDay`, `canViewCloses`, `canViewMonth`, `canCloseMonth`, `canReopenMonth`).
- Daily close: seven sections (attendance, pickups, staff, payments and cash box, expenses, incidents, issues), each "Correct" or "To fix" (with a note); an empty section asks "Yes, none", stored as a confirmed zero. The day's facts are counts only (`app_day_facts`, no amounts) and are kept with the close. Closing after `daily_close.due_time` (19:00) marks it late. At `daily_close.prompt_time` (17:00) the branch manager is reminded; at `daily_close.alert_time` (21:00) a day still open alerts the company manager. A closed day is never edited.
- Month close: Excel pack (summary, invoices, payments, expenses, cash box, credit notes) and a template from `/api/month-close/pack|template`. Template rows are codes: `check:billed`, `check:late_fees`, `check:collected`, `check:expense:<category>` (app figure pre-filled; a difference needs a note), `central:<category>` (costs paid centrally: salaries, security, marketing, rent, utilities, admin, other) and `balance:cash|bank`. Upload has a preview with row errors; a new upload replaces the month's earlier one; "Undo this upload" removes it. Late fees of a month are the late-fee days charged in it (`invoice_line.accrual_date`).
- A closed month is Verified and locked: no invoice, payment, void or expense dated in it, and its lines cannot change (`month_closed`). A late-fee invoice belongs to the month it is issued in. Reopening: the accountant asks with a reason; only the owner decides, never on their own request; both are audited.
- Data status (spec §6.1) comes from `app_kpis(branch, date)`; "All branches" takes the weakest status and works rates out again from their parts (`src/lib/data-status.ts`). Money figures are Verified once the month is closed; expenses and result stay Incomplete until a salaries line exists. `pnpm jobs` also keeps yesterday's and today's figures (`app_snapshot_kpis`, job connection only).
- Demo: `scripts/seed-demo-closing.ts` closes every working day since the start of last month (Norvale misses its last working day, closes one late and flags one section), and closes the month before last with a template, so last month is left open to try.

## Phase 7 decisions (owner experience)

- Screens: `/home` (owner and company manager: greeting, branch switcher All | Yanmu | Norvale, freshness line, "Today at a glance", "Requires your attention" (4 rows, the rest in the Inbox), Money · Children · Team · Safety tiles, legend), `/home/[kpi]` (figure detail: value and status, by branch with per-active-child money, 12-month or 14-day trend, the records behind it, the formula; Overdue tuition adds ageing, longest overdue, Excel and "Ask branches to call these families"), `/branches` (normalized comparison of spec §9.5 for a month, the better branch marked, 6-month trend), `/reports` (owner: monthly report in Excel and the list exports), `/inbox` gains "Needs me | All" and, for the owner and company manager, the full attention list.
- Calculations are pure functions in `src/lib/home.ts` (attention ranking, briefing sentences, comparison), unit-tested; the database layer is `src/db/home.ts` and `src/db/home-view.ts`. Briefing sentences are fixed templates in `home.brief.*` (Arabic written separately, with plural forms); a figure nobody entered is "—" or a "not submitted" sentence, never zero.
- Attention order (spec §9.6): critical incident; approvals for this person (money, month reopen, over capacity); families more than `attention.overdue_days` (60) late or owing more than `attention.overdue_amount_piastres` (EGP 15,000); ratio breach today and days not closed (past working days, today after 21:00); expense category more than `attention.expense_rise_percent` (20) above its 3-month average; occupancy down `attention.occupancy_drop_points` (5) in a month; unchecked cash box differences. Oldest first within a rank.
- "Operating result" on Home is the last month every branch in view has closed (Verified). Trends start at the first month with records of their kind (`firstMonths`); earlier months say "No records yet".
- "Ask branches to call these families" runs `app_ask_to_call` (`drizzle/0016_phase7_home.sql`): owner or company manager only, one high-priority issue per branch with account numbers and days late (no amounts), and an in-app alert to that branch's managers.
- Money approvals of inactive branches are no longer listed (`openMoneyRequests`).
