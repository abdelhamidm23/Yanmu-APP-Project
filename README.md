# Yanmu Nursery — Nursery Command Center

A phone-first web app for the Walid Ibrahim Group's two Yanmu nursery branches: money, children, team and safety in one place, in Arabic and English.

- Full specification: [`docs/SPEC.md`](docs/SPEC.md)
- Rules for anyone (or any AI) working on the code: [`CLAUDE.md`](CLAUDE.md)

## Status

**Phase 0 (setup)** — sign-in with two-step verification, Arabic/English with right-to-left layout, design system, and the bottom navigation for every role. The screens behind each tab are placeholders that say which phase fills them in.

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
| `branch.manager@yanmu.test` | Branch manager | |
| `accountant@yanmu.test` | Accountant | Two-step sign-in |
| `hr@yanmu.test` | HR | Two-step sign-in |
| `front.desk@yanmu.test` | Front desk | |
| `teacher@yanmu.test` | Teacher | |
| `multi.role@yanmu.test` | Front desk + Teacher | Shows the role switch in More |

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
pnpm db:migrate
pnpm seed:dev-users
pnpm dev
```

Checks: `pnpm lint`, `pnpm lint:rtl`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. CI runs all of them on every pull request.
