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
| `src/messages/{ar,en}.json` | All UI text. Arabic is written, not machine-translated. Keys must match (unit-tested). |
| `src/app/globals.css` | Design tokens from spec §12. Colour is for status only; no gold, gradients or shadows. |
| `scripts/` | `migrate.ts`, `seed-dev-users.ts` (dev only), `check-logical-css.ts` (rule 8). |
| `tests/unit/`, `e2e/` | Vitest unit tests; Playwright tests on a 390 px phone and desktop. |

## Commands

```bash
pnpm install
pnpm db:migrate          # apply migrations (needs DATABASE_URL)
pnpm seed:dev-users      # one test account per role (dev only)
pnpm dev                 # http://localhost:3000
pnpm lint && pnpm lint:rtl && pnpm typecheck && pnpm test   # fast checks
pnpm test:e2e            # end-to-end (starts the dev server; resets test accounts)
```

`docker compose up` runs Postgres and the app together.

## Conventions

- Every new screen: add its section to `SECTIONS` and the role's `NAV_BY_ROLE` entry (or gate it with `requireSection`), plus `nav.*` and `sections.*` in both message files.
- `pnpm lint:rtl` fails on physical `left`/`right` classes or CSS. Use `ms-/me-/ps-/pe-/start-/end-`. A line may opt out with a `rtl-ok` comment only when it is genuinely direction-independent.
- Use real `<button>`, `<a>`, `<label>`; icon-only buttons need `aria-label`.
- Figures use the `figure` class (tabular numbers). Format money with `formatPiastres`, never with floats.
- Never log or send personal data to services outside Egypt (rules 9 and 10). Next.js telemetry is disabled in Docker and CI.

## Phase 0 decisions and open points

- Sign-in is by email + password. MFA (authenticator app) is enforced for owner, company manager, accountant and HR (spec §14). Per-person PIN on shared class phones comes with the class-phone screens in Phase 3.
- `/` always opens Arabic. The language chosen on the sign-in screen (or in More) is saved per person.
- HR is not in the spec §11.1 nav table; its shell is Staff · Attendance · More until the owner decides.
- `user_branch_role.branch_id` has no foreign key yet; Phase 1 adds `branch` and the key, RLS policies and the audit trigger.
