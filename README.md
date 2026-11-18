# Yanmu Nursery — Nursery Command Center

A phone-first web app for the Walid Ibrahim Group's two Yanmu nursery branches: money, children, team and safety in one place, in Arabic and English.

- Full specification: [`docs/SPEC.md`](docs/SPEC.md)
- Rules for anyone (or any AI) working on the code: [`CLAUDE.md`](CLAUDE.md)

## Status

- **Phase 0 (setup)** — sign-in with two-step verification, Arabic/English with right-to-left layout, design system, and the bottom navigation for every role.
- **Phase 1 (foundation)** — branches, rooms, age bands, the working-day calendar and holidays, users and their roles per branch, adjustable thresholds, and the audit log. Open **More → Settings**. The database itself stops anyone from seeing or changing another branch's data, and every change is recorded.

The other tabs are placeholders that say which phase fills them in.

## Online demo

A demo with made-up data runs as a free **Hugging Face Space**. It needs no card and no separate database: the container holds its own Postgres, and that database starts empty on every restart.

- The sign-in screen lists one demo account per role. Tap one to sign in. The password for all of them is shown there too.
- Two-step sign-in is offered but not forced in the demo, so every role can be opened without an authenticator app.
- The Space sleeps after two days without visitors, and the first visit after that takes a few minutes.
- **Never enter real children, families or staff in the demo.** It is not hosted in Egypt (rule 10).

To set it up: create a free account at huggingface.co, then make a new Space (SDK **Docker**, template **Blank**, hardware **CPU basic**, visibility **Public**). Add a file named `Dockerfile` with the contents of [`deploy/huggingface/Dockerfile`](deploy/huggingface/Dockerfile). Open the app at `https://<user>-<space>.hf.space`, not on the huggingface.co page, which shows it inside a frame. To load newer code from the `preview` branch, press **Settings → Factory rebuild** in the Space.

[`render.yaml`](render.yaml) does the same on Render (app) with Neon (database) for accounts that already have a card on Render.

## Try it on your computer and phone

You need **Docker Desktop** (free): https://www.docker.com/products/docker-desktop/ — install it and open it once.

1. Download this project: on GitHub press **Code → Download ZIP**, then unzip it.
2. Open a terminal in the unzipped folder (Mac: right-click the folder → *New Terminal at Folder*; Windows: open the folder, type `cmd` in the address bar, press Enter).
3. Copy and paste:

   ```bash
   docker compose up --build
   ```

   The first time takes a few minutes. When you see **`Ready`**, open http://localhost:3000 in your browser. You should see the Arabic sign-in screen.

4. Sign in with any test account below. The password for all of them is `Yanmu-dev-2026!`

| Email | Role | Notes |
| --- | --- | --- |
| `owner@yanmu.test` | Owner | Asks you to set up two-step sign-in first |
| `company.manager@yanmu.test` | Company manager | Two-step sign-in |
| `branch.manager@yanmu.test` | Branch manager, Branch A | Can add holidays for Branch A only |
| `branch.manager.b@yanmu.test` | Branch manager, Branch B | Sees only Branch B |
| `accountant@yanmu.test` | Accountant | Two-step sign-in |
| `hr@yanmu.test` | HR | Two-step sign-in |
| `front.desk@yanmu.test` | Front desk, Branch A | |
| `teacher@yanmu.test` | Teacher, Branch A | |
| `multi.role@yanmu.test` | Front desk + Teacher, Branch B | Shows the role switch in More |

Settings (users, rooms, thresholds, audit log) are open to the owner and company manager. Branch managers see the calendar for their own branch.

For two-step sign-in, install **Google Authenticator** or **Microsoft Authenticator** on your phone and scan the square code the app shows.

### On your phone (same Wi-Fi as the computer)

1. Find your computer's Wi-Fi address (Mac: System Settings → Wi-Fi → Details → IP address; Windows: run `ipconfig` and look for *IPv4 Address*). It looks like `192.168.1.20`.
2. Stop the app (press `Ctrl + C` in the terminal), then start it again with your address in place of the example:

   ```bash
   BETTER_AUTH_URL=http://192.168.1.20:3000 TRUSTED_ORIGINS=http://192.168.1.20:3000 docker compose up
   ```

   On Windows `cmd`, run these three lines instead:

   ```
   set BETTER_AUTH_URL=http://192.168.1.20:3000
   set TRUSTED_ORIGINS=http://192.168.1.20:3000
   docker compose up
   ```

3. On the phone, open `http://192.168.1.20:3000`.

To stop everything: `Ctrl + C`, then `docker compose down`.

## For developers

Requires Node 22, pnpm 10 and PostgreSQL 16 (or use Docker for the database only: `docker compose up db`).

```bash
cp .env.example .env
pnpm install
pnpm db:setup          # migrations + organization, branches, age bands, settings
pnpm seed:dev-users
pnpm dev
```

Checks: `pnpm lint`, `pnpm lint:rtl`, `pnpm typecheck`, `pnpm test`, `pnpm test:db` (branch isolation and audit, needs the database), `pnpm test:e2e`. CI runs all of them on every pull request.

The app connects as `yanmu_app`, a database role bound by row-level security. Migrations and seed scripts use the owner (`MIGRATION_DATABASE_URL`). See `.env.example`.
