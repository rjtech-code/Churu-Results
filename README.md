# Churu ZP-PS Election Results Portal

Results portal for the Churu district Panchayat elections: Zila Parishad (ZP) and Panchayat Samiti (PS)
members, ward-wise. Project rules are in [CLAUDE.md](CLAUDE.md). This repository is built in numbered parts.
**Done so far: Part 1** (project skeleton, MySQL in Docker, locked-down schema, tests).

```
backend/    Node.js + Express + TypeScript API, Knex migrations, tests
frontend/   (Part 8)
docker/     MySQL init script (creates databases and users)
docs/       reference files (do not edit)
```

## Setup from zero on a fresh Ubuntu machine (22.04 / 24.04)

### 1. Install the tools

```bash
sudo apt update
sudo apt install -y git curl ca-certificates openssl

# Docker Engine + Compose plugin
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"     # then log out and back in so `docker` works without sudo

# Node.js 24 (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version                       # must print v24.x
docker compose version
```

### 2. Get the code and create the env file

```bash
git clone <repo-url> Churu-Results
cd Churu-Results
cp backend/.env.example backend/.env
chmod 600 backend/.env
```

Edit `backend/.env` and fill in the three empty passwords (at least 12 characters each). To generate them:

```bash
openssl rand -base64 24 | tr -d '/+='
```

`backend/.env` is used by both the app **and** docker-compose (which creates the DB users from it).
It is git-ignored: never commit it.

### 3. Start MySQL

```bash
docker compose up -d
docker compose ps        # wait until STATUS shows "(healthy)", about 30 s on the first run
```

MySQL **8.4 LTS** (image pinned in `docker-compose.yml`) listens on **127.0.0.1:3307** only, so it never conflicts with a local MySQL on 3306 and
can't be reached from the network. On first start the init script creates `churu_dev`, `churu_test`,
the migration user and the app user.

> The init script runs only when the data volume is empty. If you change DB names, users or passwords
> in `.env` later, recreate the volume: `docker compose down -v && docker compose up -d`
> (**this deletes all data**).

### 4. Install, migrate, test

```bash
cd backend
npm ci
npm run migrate          # creates the schema in churu_dev + applies app-user grants
npm run migrate:test     # same for churu_test (npm test also does this itself)
npm test
npm run lint
npm run typecheck
```

### 5. Run the API

```bash
npm run dev                              # development, auto-reload
curl http://localhost:3000/api/health    # {"status":"ok","db":"ok"}
```

Production build: `npm run build && npm start`. Migrations also run from the build:
`node dist/db/migrate.js latest`.

## npm scripts (in `backend/`)

| Script | What it does |
|---|---|
| `dev` | Start the API with auto-reload (tsx) |
| `build` / `start` | Compile to `dist/` / run the compiled server |
| `test` | Vitest + Supertest against the real `churu_test` database |
| `lint` / `typecheck` / `format` | ESLint / `tsc --noEmit` / Prettier |
| `migrate` | Apply all pending migrations to `churu_dev`, then re-apply app-user grants |
| `migrate:rollback` | Roll back the last migration batch on `churu_dev` |
| `migrate:test` | Apply migrations + grants to `churu_test` |

## Database users

| User | Rights | Used by |
|---|---|---|
| `DB_MIGRATION_USER` | ALL on `churu_dev` / `churu_test` (with GRANT OPTION) | migrations and the grants step only |
| `DB_APP_USER` | per table: SELECT/INSERT/UPDATE/DELETE; **SELECT/INSERT only** on `audit_log` and `ward_declarations`; no CREATE/DROP/ALTER/TRIGGER | the running API |

App-user grants are listed in `backend/src/db/grants.ts` and re-applied after every `migrate`.
If a migration adds a table that isn't listed there, `migrate` fails on purpose, so every new table
needs an explicit privilege decision.

## Safety notes
- Tests refuse to run unless the test database name ends in `_test`, so they can't touch `churu_dev`.
- `audit_log` and `ward_declarations` are append-only: triggers block UPDATE/DELETE for **every** user,
  and the app user has no UPDATE/DELETE privilege on them at all.
