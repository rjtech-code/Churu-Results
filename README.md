# Churu ZP-PS Election Results Portal

Results portal for the Churu district Panchayat elections: Zila Parishad (ZP) and Panchayat Samiti (PS)
members, ward-wise. Project rules are in [CLAUDE.md](CLAUDE.md). This repository is built in numbered parts.
**Done so far: Part 1** (project skeleton, MySQL in Docker, locked-down schema, tests) and
**Part 2** (master-data import scripts and user accounts, run from the command line on the server).

```
backend/    Node.js + Express + TypeScript API, Knex migrations, tests
  scripts/  command-line master-data scripts (imports, ballot lock, users)
  reports/  every script run's report (git-ignored; keep and back these up)
frontend/   (Part 8)
docker/     MySQL init script (creates databases and users)
docs/       reference files; docs/templates/ holds the import templates
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

## Master data runbook (Part 2)

All master data is loaded by command-line scripts **on the server**, never through a web page.
Run them from `backend/`. File paths are relative to where you type the command.

**How every script behaves:**
- **Dry run by default.** Without `--commit` it checks everything (including database rules)
  and prints a report, but writes **nothing**. Read the report, then run the same command again with `--commit`.
- **All or nothing.** One transaction per run; a single bad row means nothing is written.
- **Reports.** Every run prints a report and saves it to `backend/reports/<script>-<timestamp>.txt`.
  Each problem is listed with its Excel row number. Keep these files.
- **Exit code** is 0 on success, 1 on data errors, 2 on a wrong command line.
- **Audit.** Every committed run writes one `audit_log` row (no passwords, ever).

Do the steps **in this order** on a freshly migrated server (`npm run migrate`):

### 1. Geography (Panchayat Samitis, PS wards, ZP wards, booths)

```bash
cd backend
cp ../docs/ps-names.example.json ../docs/ps-names.json      # fill in the 13 Hindi names
npm run import:geography -- --file ../docs/polling-stations.xlsx --ps-names ../docs/ps-names.json
```
Check the derived counts against the official ones (13 / 231 / 39 / 1,359).
Every booth must have exactly one PS ward, one ZP ward and one name. A conflicting booth is an error.
To correct one, add an entry to `docs/data-fixes.json`; see `docs/data-fixes.example.json` for the format.
Every fix needs `reason`, `approved_by` and `approved_on`. Then:
```bash
npm run import:geography -- --file ../docs/polling-stations.xlsx --ps-names ../docs/ps-names.json \
  --fixes ../docs/data-fixes.json --commit
```
Re-importing needs `--replace`, which is refused once any candidate or counting entry exists.
`--replace` keeps the Panchayat Samiti rows but re-creates wards and booths, so voter counts must be imported again.

### 2. Parties
Copy `docs/templates/parties-template.xlsx` and fill in `name_hindi, name_english, short_name, symbol`.
```bash
npm run import:parties -- --file <parties.xlsx>            # dry run, then add --commit
```

### 3. Voter counts
```bash
npm run export:voter-template        # writes docs/templates/voter-counts-template.xlsx (one row per booth)
```
Send it to the officials. They fill `voters_male`, `voters_female`, `voters_other` (may be empty = 0)
and `voters_total`, where total = male + female + other. Every booth must be present exactly once.
```bash
npm run import:voters -- --file <filled.xlsx>               # dry run, then add --commit
```

### 4. Candidates
Copy `docs/templates/candidates-template.xlsx` and **delete the two EXAMPLE rows**; any row containing
"EXAMPLE" is rejected. One row per candidate:
- `election` is `PS` or `ZP`. `panchayat_samiti` is left empty for ZP.
- `ballot_position` runs 1..N per ward.
- An empty `party_short_name` means independent.
- `gender` is M, F or O. `reservation_category` must be the same on every row of a ward.
```bash
npm run import:candidates -- --file <candidates.xlsx>       # dry run, then add --commit
```
NOTA is added automatically at position N+1. A ward with exactly one candidate is marked **unopposed**
and gets no NOTA. Running the import again replaces the candidates of the wards in that file only, and
only while they are unlocked with no counting entries. The report lists exactly which wards were replaced.

### 5. Ballot report
```bash
npm run ballot:report                     # all PS sheets + a ZP sheet -> backend/reports/ballot-report-*.xlsx
npm run ballot:report -- --ps "CHURU PANCHAYAT SAMITI"
```

### 6. Cross-check
Print the report. **Two people** check it line by line against the official candidate list.
To fix a mistake, correct the file and run step 4 again.

### 7. Lock the ballots
```bash
npm run ballot:lock -- --ps "CHURU PANCHAYAT SAMITI" --by "Name, designation" --commit   # type LOCK to confirm
npm run ballot:lock -- --ward <ward id> --by "Name, designation" --commit
npm run ballot:lock -- --all --by "Name, designation" --commit
```
A ward with no candidates is an error, and nothing is locked. Already-locked wards are skipped.
A locked ward's candidates can't be changed. To unlock (only possible before any counting entry):
```bash
npm run ballot:unlock -- --ward <ward id> --reason "why" --by "Name, designation" --commit
```

### 8. User accounts (exactly 15)
```bash
npm run users:create -- --role PS_RO --username ro_churu --ps "CHURU PANCHAYAT SAMITI" --full-name "Name" --commit
npm run users:create -- --role ZP_RO --username ro_zp --full-name "Name" --commit
npm run users:create -- --role DM    --username dm_churu --full-name "Name" --commit
npm run users:list
```
- **Limits:** 13 PS_RO (one per PS), 1 ZP_RO and 1 DM. Disabled accounts still count.
- **Usernames:** 4-30 characters, lowercase letters, digits and `_`.
- **Passwords:** the password is printed **once** on the terminal and saved nowhere. Hand it over in person.

Other user commands:
```bash
npm run users:reset-password -- --username <u> --commit   # new password; clears lockout
npm run users:disable -- --username <u> --commit
npm run users:enable  -- --username <u> --commit
```

`npm run templates:generate` re-creates the empty parties and candidates templates.

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
