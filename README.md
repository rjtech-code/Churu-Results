# Churu ZP-PS Election Results Portal

Results portal for the Churu district Panchayat elections: Zila Parishad (ZP) and Panchayat Samiti (PS)
members, ward-wise. Project rules are in [CLAUDE.md](CLAUDE.md). This repository is built in numbered parts.
**Done so far: Part 1** (project skeleton, MySQL in Docker, locked-down schema, tests) and
**Part 2** (master-data import scripts and user accounts, run from the command line on the server) and
**Part 3** (login, sessions, CSRF, rate limits, role and ownership checks) and
**Part 4** (the result engine) and
**Part 5** (booth and postal entry API).

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

Edit `backend/.env` and fill in the three empty passwords (at least 12 characters each) and
`SESSION_SECRET` (at least 32 characters). To generate them:

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
npm run users:create -- --role PS_RO --username ro_chu_h3w8 --ps "CHURU PANCHAYAT SAMITI" --full-name "Name" --commit
npm run users:create -- --role ZP_RO --username zp_ro_p4x9 --full-name "Name" --commit
npm run users:create -- --role DM    --username dm_q8t3 --full-name "Name" --commit
npm run users:list
```
- **Usernames get a random suffix**, e.g. `ro_rjg_k7m2`, `zp_ro_p4x9`, `dm_q8t3` (4 random letters/digits
  chosen when the account is created). **Never derive usernames from the PS name alone.**
- **Limits:** 13 PS_RO (one per PS), 1 ZP_RO and 1 DM. Disabled accounts still count.
- **Usernames:** 4-30 characters, lowercase letters, digits and `_`.
- **Passwords:** the password is printed **once** on the terminal and saved nowhere. Hand it over in person.

Other user commands:
```bash
npm run users:reset-password -- --username <u> --commit   # new password; clears lockout
npm run users:disable -- --username <u> --commit
npm run users:enable  -- --username <u> --commit
npm run users:unlock  -- --username <u> --by "Name" --commit   # clear a login lockout (password unchanged)
```

`npm run templates:generate` re-creates the empty parties and candidates templates.

## Login, sessions and CSRF (Part 3)

All API calls are same-origin JSON. There is **no CORS**: the API sends no CORS headers.

| Endpoint | What it does |
|---|---|
| `GET /api/auth/csrf` | `{ "csrfToken": "..." }` for the current session (creates the session if needed) |
| `POST /api/auth/login` | body `{ "username", "password" }` → 200 with the same body as `/me` |
| `POST /api/auth/logout` | 204; the session is destroyed and the cookie cleared |
| `GET /api/auth/me` | `{ id, username, fullName, role, panchayatSamiti: { id, name } \| null }`, or 401 |

**How a client must call the API**
1. `GET /api/auth/csrf` and keep the `csrfToken`.
2. Send it in the **`X-CSRF-Token`** header on **every POST/PUT/PATCH/DELETE**, login and logout included.
   A missing or wrong token gives 403 `CSRF_FAILED`.
3. **After login and after logout, call `GET /api/auth/csrf` again.** The token changes (login gets a
   new session id and a new token; logout destroys the session).
4. If an `Origin` header is sent with a POST/PUT/PATCH/DELETE, it must equal `APP_ORIGIN`. Otherwise the
   answer is 403 `ORIGIN_REJECTED`.

**Sessions**
- **Storage:** MySQL table `sessions`. Cookie `churu.sid`: HttpOnly, SameSite=Strict, Path=/, and Secure in production.
- **Idle timeout:** `SESSION_IDLE_MINUTES` (default 30). Every request pushes the expiry forward.
- **Absolute lifetime:** `SESSION_ABSOLUTE_HOURS` (default 14) after login, even if the session is active.
  When it ends, the client gets 401 `SESSION_EXPIRED` once; after that it is `UNAUTHENTICATED`.
- **Fresh user check:** every request re-reads the user from the database. A disabled user
  (`npm run users:disable`) is out on the very next request. Role and Panchayat Samiti always come from
  the database, never from the session.

**Login errors**
- Unknown user, wrong password and disabled user all get the same 401 `INVALID_CREDENTIALS`.
- **Lockout:** 5 wrong passwords lock the account for 15 minutes. While locked, **every** attempt gets
  423 `{"error":"ACCOUNT_LOCKED","retryAfterSeconds":n}`, and the password is not even checked.
- Unknown usernames always get 401, never 423.
- A malformed body gets 400 `VALIDATION_FAILED`.

**Decision (recorded after Part 3): locked accounts get HTTP 423, on purpose**
- **Why:** officers must see a clear "account locked, try again in N minutes" message on counting day,
  instead of a confusing "wrong password".
- **Accepted risk:** a 423 can only come from a real account, so it shows that a username exists.
- **Mitigations:**
  - **Usernames can't be guessed.** Every account gets a random suffix when it is created, e.g.
    `ro_rjg_k7m2`, never just `ro_rajgarh`.
  - **LAN only.** The counting-day system runs only on the local LAN, not the internet.
  - **Quick unlock.** `npm run users:unlock -- --username <u> --by "<name>" --commit` clears a lock in
    seconds (audited), without changing the password.

**Rate limits** (per client IP)
- Login: 20 attempts per 15 minutes.
- All `/api` routes: 600 per minute. `/api/health` is never limited.
- Over the limit: 429 `TOO_MANY_REQUESTS`.
- **The counters are kept in memory**, which is correct for our deployment of **one Node process**.
  Running several processes or servers would need a shared store; otherwise each one counts separately.
- Behind a reverse proxy (Caddy), set `TRUST_PROXY=loopback` (or the number of proxy hops) so the
  real client IP is used. **Never `true`**, because then anyone could fake their IP with `X-Forwarded-For`.

**Roles** (checked on the server for every request)
- **DM:** read-only. A global guard returns 403 to any DM POST/PUT/PATCH/DELETE except login and logout.
- **PS_RO:** only PS ballots and wards of their own Panchayat Samiti.
- **ZP_RO:** only ZP ballots and wards.
- Later parts use `requireAuth`, `requireRole(...)` (`src/middleware/auth.ts`) and `canWriteBallot`,
  `canWriteWard` and `canReadWard` (`src/services/access.ts`).

**Audit:** LOGIN_SUCCESS, LOGIN_FAILED, ACCOUNT_LOCKED, LOGOUT and SESSION_EXPIRED_ABSOLUTE are written to
`audit_log` with the IP. Passwords, hashes, session ids and CSRF tokens are never stored.

### Log in from the terminal with curl

```bash
B=http://localhost:3000; J=/tmp/churu-cookies.txt; rm -f "$J"
T=$(curl -s -c "$J" -b "$J" $B/api/auth/csrf | sed 's/.*"csrfToken":"\([^"]*\)".*/\1/')
curl -s -c "$J" -b "$J" -H 'Content-Type: application/json' -H "X-CSRF-Token: $T" \
     -d '{"username":"dm_q8t3","password":"<password>"}' $B/api/auth/login
curl -s -c "$J" -b "$J" $B/api/auth/me
T=$(curl -s -c "$J" -b "$J" $B/api/auth/csrf | sed 's/.*"csrfToken":"\([^"]*\)".*/\1/')   # new token after login
curl -s -c "$J" -b "$J" -X POST -H "X-CSRF-Token: $T" -o /dev/null -w '%{http_code}\n' $B/api/auth/logout
```

## How results are calculated (Part 4)

All vote arithmetic happens in **one place**: `backend/src/services/result.ts`. It is a pure function: it has no
database, no clock and no randomness, so the same saved data always gives the same result. Everything else
(screens, reports, declare) asks this engine; nothing else adds votes.

**Totals and ranks**
- A candidate's total = their votes from every entered booth of the ward + their postal votes.
- A ZP ward's booths are all booths of that ZP ward, across every Panchayat Samiti.
- Valid votes = all candidates + NOTA. Rejected postal ballots are shown separately and are **not**
  valid votes. That rule lives in one function, `expectedPostalVoteSum`, so it is easy to change.
- **Ranks** are shared on equal votes (1, 1, 3) and run over real candidates only.
- **Leader, runner-up and top-3** are real candidates only. Equal votes are listed in ballot order, except
  in a declared ward: there the declared winner (for a tie, the lottery winner) is always the leader and
  the first row. Both tied candidates still have rank 1.
- NOTA is never among them, even when it has the
  most votes; then the `notaHighest` flag is shown, but nothing else changes.
- **Margin** = leader's votes − runner-up's votes.

**Status of a ward**

| Status | When |
|---|---|
| `UNOPPOSED` | One candidate only. Final; never counted and never declared. The cross-check and ballot lock are its confirmation. |
| `NOT_STARTED` | Nothing entered yet. |
| `COUNTING` | Some data entered, but not every booth or not the postal ballots. |
| `READY_TO_DECLARE` | Every booth and the postal ballots entered, and the top two candidates are not equal. |
| `TIE_NEEDS_LOTTERY` | Everything entered, and the top two real candidates have equal votes (also 0 = 0). The system **never** picks a winner; the RO records the lottery result. |
| `DECLARED` / `TIE_RESOLVED` | A declaration exists. The winner, margin and version come from it. |

During counting, an equal top is shown as `topTied` only.

**Alarm:** `declarationMismatch` is true if a declared ward's current votes ever differ from the votes
saved at declaration time, or if the declared winner no longer has the most votes. The engine never
reorders candidates against the votes.

**The engine refuses impossible data** (`ResultInputError`). The database already prevents these;
the engine checks again:
- a vote for a candidate of another ward
- a missing or duplicate vote row (a missing row is never treated as 0)
- a booth of another ward, or the same booth twice
- negative or non-whole numbers
- votes that do not add up to the sheet total
- two NOTAs
- entries or a declaration on an unopposed ward

**Loading:** `backend/src/services/result-loader.ts` reads a ward, or many wards, in **one read-only,
consistent snapshot**. It always runs the same 8 queries, however many wards it loads, and it never writes.

**Inspect a ward by eye** (read only):
```bash
npm run result:ward -- --ward <ward id>     # ward ids: npm run ballot:report
npm run test:coverage                       # coverage of result.ts (100% lines and branches)
```

## Counting API: entering result sheets (Part 5)

The PS_RO and ZP_RO type each booth's approved result sheet (parchi) and each ward's postal ballots.
- **Who may use it:** every route needs login and the role **PS_RO or ZP_RO**. The DM gets 403 on all
  `/api/counting` routes, reads included; the DM uses reports.
- **Writes** need the `X-CSRF-Token` header (see Part 3).
- **Scope:** a PS_RO only sees and writes PS ballots and PS wards of its own Panchayat Samiti. A ZP_RO only
  sees and writes ZP ballots and ZP wards, booths of every PS included.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/counting/wards` | Your wards with status, booths entered/total, postal entered. A ward without candidates shows `NO_CANDIDATES`. |
| GET | `/api/counting/wards/:wardId/booths` | Booths of the ward (with the entry id if entered) and the postal entry state |
| GET | `/api/counting/wards/:wardId/ballot` | Candidates in ballot order, NOTA included: the entry form |
| GET | `/api/counting/entries/:entryId` | One booth entry with its votes and `rowVersion` (for the edit form) |
| GET | `/api/counting/entries/:entryId/history` | Who did what and when, with old/new values and reasons (also after a void) |
| POST | `/api/counting/entries/preview` | Same body and checks as create; **saves nothing**. Returns the summary and the ward as it would become (the confirm screen). |
| POST | `/api/counting/entries` | Save a booth sheet → 201: `{wardId, boothId, ballotFor, roundNo, sheetTotal, votes:[{candidateId, votes}]}` |
| PUT | `/api/counting/entries/:entryId` | Correct votes/round before declare: `{rowVersion, roundNo, sheetTotal, votes, reason}` |
| POST | `/api/counting/entries/:entryId/void` | Void a wrong entry: `{rowVersion, reason}` |
| GET | `/api/counting/postal/:entryId` and `.../history` | Postal entry, and its history |
| POST | `/api/counting/wards/:wardId/postal/preview` | Postal preview (saves nothing) |
| POST | `/api/counting/wards/:wardId/postal` | Save the ward's postal sheet (one per ward): `{sheetTotal, rejectedCount?, votes}` |
| PUT | `/api/counting/postal/:entryId` | `{rowVersion, sheetTotal, rejectedCount?, votes, reason}` |
| POST | `/api/counting/postal/:entryId/void` | `{rowVersion, reason}` |

**What every write returns**
- the saved entry, with its new `rowVersion`
- the ward's fresh result, computed by the result engine after the commit
- `warnings`

**Rules for every sheet**
- `votes` must have exactly one row for **every** candidate of the ward, NOTA included. A zero must be typed.
- The vote sum must equal `sheetTotal`. For postal sheets, `rejectedCount` is stored, but it is **not** part of the
  sum; that rule lives in `result.ts`.
- `reason` (PUT and void): 10–500 characters.
- Candidate names, wards and booths are always looked up on the server, never taken from the client.

**Error codes.** Every error is `{"error": CODE, ...details}`.

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Body or id is malformed. `details: [{path, message}]` (values are never echoed). |
| `BOOTH_NOT_IN_WARD` | 400 | The booth is not in the `wardId` the form was opened for (for that ballot). |
| `VOTES_INCOMPLETE` | 400 | A candidate (or NOTA) has no row: `missingCandidateIds`. |
| `UNKNOWN_CANDIDATE` | 400 | A row for a candidate of another ward: `candidateIds`. |
| `DUPLICATE_CANDIDATE` | 400 | The same candidate twice: `candidateIds`. |
| `SUM_MISMATCH` | 400 | Votes do not add up to the sheet total: `sum`, `sheetTotal`. |
| `EXCEEDS_REGISTERED_VOTERS` | 400 | Booth sheet total > registered voters: `sheetTotal`, `registeredVoters`. |
| `UNAUTHENTICATED` | 401 | Not logged in. |
| `FORBIDDEN` | 403 | Not your ballot / ward, or DM. (`CSRF_FAILED` / `ORIGIN_REJECTED`: see Part 3.) |
| `NOT_FOUND` | 404 | Unknown booth, ward or entry. |
| `BALLOT_NOT_LOCKED` | 409 | The ward's candidate list is not locked yet (`npm run ballot:lock`). |
| `WARD_UNOPPOSED` | 409 | Unopposed wards are never counted. |
| `WARD_DECLARED` | 409 | The ward is declared; changes go through Part 6 corrections. |
| `ALREADY_ENTERED` | 409 | This booth/ballot (or this ward's postal) already has an entry. Edit or void it. |
| `STALE_VERSION` | 409 | Someone changed the entry meanwhile: `currentRowVersion`. Reload and redo. |
| `VOTER_COUNT_MISSING` | 409 | The booth has no registered-voter count and `REQUIRE_VOTER_COUNTS=true`. |

**`REQUIRE_VOTER_COUNTS`.** Rule 7 (booth total ≤ registered voters) needs the voter counts from `import:voters`.
- **Default:** `true` in production, `false` otherwise.
- **When `false`:** a booth without a count can be saved, and the response carries
  `"warnings": ["VOTER_COUNT_MISSING"]`.
- **When `false` in production:** startup prints a loud warning and writes a `CONFIG_VOTER_CHECK_DISABLED`
  audit row.

**Void, in plain words.** Void takes a wrong entry out of counting, for example one typed against the wrong
booth, so that booth can be entered again. Nothing is lost:
- the full entry (votes, who typed it and when, its edits) is copied into `voided_entry`, which can never be
  changed or deleted
- an `ENTRY_VOIDED` audit row records it with the reason
- only then is the live entry removed, all in one transaction

There is no "undo void": re-enter the booth with a normal create. The history endpoint still shows the voided entry.

**Lock order (every counting write, and Part 6 declare)**
1. Lock the **ward row** (`SELECT … FROM ward WHERE id = ? FOR UPDATE`). This is always the first lock.
2. Check the ward: unopposed, ballot locked, declared.
3. Lock the entry row (edit/void) and check its `row_version`.
4. Write the entry and vote rows (and the archive), then the audit row, then commit.

Because entry writes and declare both lock the same ward row first:
- an entry and a declaration can never overlap; whichever comes second sees the other's committed data
- two writes on one ward run one after the other
- `row_version` makes a stale edit fail with `STALE_VERSION` instead of overwriting someone else's change

After every successful commit an in-process `ward-changed` event is emitted, for the live screens in Part 7.

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
