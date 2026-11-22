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
- **Classes:** Yanmu 6 (Babies 1, Toddlers 1, Juniors 1, Juniors 2, Seniors 1, Seniors 2; "Toddlers 2" was renamed "Juniors 2" on 2026-11-22), Norvale 8 (`scripts/seed-demo.ts` PLAN). `pnpm seed:demo` rebuilds the demo by itself when the classes or their demo children no longer match PLAN, so an old demo database picks up a new layout on the next start.
- **Hours:** Sunday–Thursday, `attendance.opening_time` 08:00, `attendance.closing_time` 16:00, `attendance.after_school_minutes` 60. Edited on Settings → Calendar and hours (owner and company manager). The "still checked in" alert on Today starts when the after-school time ends (17:00).
- **"Daily attendance", not "Roll call"** (owner, 2026-11-22): the screen is labelled "Daily attendance" / "الحضور اليومي" (tab "Attendance" / "الحضور"). The route stays `/roll-call` and the message keys keep their names. The children import template's column is "Class" (an old "Room" column is still read).
- **QR pickup is out of scope for now** (owner, 2026-11-22): parents already use a separate app that gives each child a new pickup code every day, and the admin team scans it there. Check-out in this app is by the approved-adults list only. A QR version was built and then removed on the review branch; `drizzle/0007_remove_qr_pickup.sql` cleans any database that ran it. The code is in the git history (commit 954790a) if the owner asks for it later.

