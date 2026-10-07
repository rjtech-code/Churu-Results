# Churu ZP-PS Election Results Portal

Results portal for the Churu district Panchayat elections: Zila Parishad (ZP) and Panchayat Samiti (PS)
members, ward-wise. Project rules are in [CLAUDE.md](CLAUDE.md). This repository is built in numbered parts.
**Done so far: Part 1** (project skeleton, MySQL in Docker, locked-down schema, tests) and
**Part 2** (master-data import scripts and user accounts, run from the command line on the server) and
**Part 3** (login, sessions, CSRF, rate limits, role and ownership checks) and
**Part 4** (the result engine) and
**Part 5** (booth and postal entry API) and
**Part 6** (declare, tie lottery, post-declare correction, demo data) and
**Part 7** (public screen API, live updates, screen layout, demo simulation) and
**Part 8** (the Hindi operator dashboard for PS/ZP Returning Officers, served by the backend) and
**Part 9** (the three media-room TV screens; 9.2: redesign and Hindi PS names) and
**Part 10** (the DM's read-only reports).

```
backend/    Node.js + Express + TypeScript API, Knex migrations, tests
  scripts/  command-line master-data scripts (imports, ballot lock, users)
  reports/  every script run's report (git-ignored; keep and back these up)
frontend/   React + Vite operator dashboard (Hindi); built to frontend/dist, served by the backend
  e2e/      Playwright tests against the production build
package.json  root: `npm run build` / `npm start` for production
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
| GET | `/api/counting/booths/:boothId/history?ballotFor=PS\|ZP` | The **whole story** of one booth ballot, oldest first: every entry ever made for it (the live one and every voided one, from `voided_entry`) with all their audit rows: created, updated, voided, re-created … Each event has `entryId` and `entryVoided`. Same permission as the entry. |
| GET | `/api/counting/postal/:entryId` and `.../history` | Postal entry, and its history |
| GET | `/api/counting/wards/:wardId/postal/history` | The whole story of the ward's postal ballots (live + every voided postal entry), oldest first. Same permission as the postal entry. |
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
- `reason` (PUT and void): 10–500 characters. The dashboard builds it from a standard reason (पर्ची पढ़ने में
  गलती / टाइपिंग में गलती / गलत बूथ चुना गया / पर्ची बाद में संशोधित हुई / अन्य) plus details, as
  "<reason> — <details>"; "अन्य" needs details of at least 10 characters.
- **No-change edits:** a PUT identical to the saved entry (same round, total, rejected count and votes) is
  refused with 400 `NO_CHANGE`. Nothing is written: no `row_version` bump and no audit row.
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
| `NO_CHANGE` | 400 | PUT identical to the saved entry; nothing written |
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

## Declare, tie lottery and correction (Part 6)

Only the ward's own RO can declare: the PS_RO for PS wards of its Panchayat Samiti, the ZP_RO for ZP wards.
The DM gets 403 on all `/api/declare` routes. Unopposed wards are **never** declared through the system;
their cross-checked, locked ballot is their confirmation.

| Method | Path | What it does |
|---|---|---|
| POST | `/api/declare/wards/:wardId/preview` | Body `{}`. Shows the current result and exactly what would be stored (version, winner, margin, snapshot), or that a lottery is needed and between whom. Saves nothing. |
| POST | `/api/declare/wards/:wardId` | Declare: `{password, confirmWinnerCandidateId, confirmTotalValidVotes, lottery?, acknowledgeNotaHighest?}` |
| POST | `/api/declare/wards/:wardId/correction/preview` | Body `{changes}`. The ward before and after the correction. Saves nothing. |
| POST | `/api/declare/wards/:wardId/correction` | Correct a declared ward: `{password, reason, changes, confirmWinnerCandidateId, confirmTotalValidVotes, lottery?, acknowledgeNotaHighest?}` |
| GET | `/api/declare/wards/:wardId/declarations` | Every declaration version, oldest first, with lottery, NOTA acknowledgement and correction reasons |

**Declaring, in plain words**
1. The RO types their **password again**.
   - A wrong password counts toward the normal 5-attempt lockout and is audited (`REAUTH_FAILED`).
   - A locked account gets 423 straight away.
2. A ward can only be declared when **every booth and the postal ballots** are entered.
3. The RO **confirms the winner and the total valid votes they see on screen**. If the numbers changed
   meanwhile (another tab, another officer), the server answers `RESULT_CHANGED` with the fresh result
   and nothing is declared.
4. **Tie at the top:** the system never picks a winner. The RO holds the lottery as the rules require, then
   records it: `lottery: {winnerCandidateId, conductedBy, note}`. The winner must be one of the tied
   candidates. It is stored as `TIE_RESOLVED` with margin 0, and the lottery details are kept forever.
5. **NOTA has the most votes:** the official rule is not confirmed yet, so the winner logic is unchanged.
   The RO must explicitly acknowledge it (`acknowledgeNotaHighest: true`), and that is recorded.
6. The declaration stores a snapshot of every candidate's votes, built by `buildDeclarationSnapshot`.

**Correcting a declared ward.** Numbers of a declared ward change **only** here; Part 5's edit and void
answer `WARD_DECLARED`. One request, one transaction:
1. Fix the affected entries (`changes`: booth or postal sheets with their `rowVersion`). The same sheet
   checks as Part 5 apply.
2. The new result is computed.
3. The usual confirm, lottery and NOTA rules apply.
4. A **new declaration version** is stored with the reason. **Older versions are never changed**; the
   database blocks it.

There is never a "reopened" ward. If the corrected numbers are identical to the current ones, the
answer is `NO_CHANGE`; a round number alone is not a result change.

**Lock order.** Declare and correction follow the same lock order as Part 5:
1. Password check, **before** any lock.
2. **Ward row `FOR UPDATE`.**
3. Entries.
4. Writes and audit.
5. Commit.

So a declare and an entry write on the same ward never overlap: whichever comes second sees the other.

| Code | HTTP | Meaning |
|---|---|---|
| `REAUTH_FAILED` | 401 | Wrong password at the re-check (counted toward the lockout) |
| `ACCOUNT_LOCKED` | 423 | Account locked; `retryAfterSeconds`. The password was not checked. |
| `WARD_UNOPPOSED` | 409 | Unopposed wards are never declared |
| `ALREADY_DECLARED` | 409 | Use correction instead |
| `COUNTING_INCOMPLETE` | 409 | Not every booth/postal entered: `boothsEntered`, `boothsTotal`, `postalEntered` |
| `RESULT_CHANGED` | 409 | The confirmed winner or total no longer matches: `result` holds the fresh result |
| `LOTTERY_REQUIRED` | 400 | Top is tied: `tiedCandidateIds` |
| `LOTTERY_NOT_ALLOWED` | 400 | A lottery was sent but there is no tie |
| `LOTTERY_WINNER_NOT_TIED` | 400 | The lottery winner is not one of `tiedCandidateIds` |
| `NOTA_HIGHEST_ACK_REQUIRED` | 409 | NOTA has the most votes; acknowledge it explicitly |
| `NOT_DECLARED` | 409 | Correction of a ward that has no declaration |
| `ENTRY_NOT_IN_WARD` | 400 | A change refers to an entry of another ward |
| `DUPLICATE_CHANGE` | 400 | The same entry twice in `changes` |
| `NO_CHANGE` | 400 | The corrected numbers equal the current declaration |
| `STALE_VERSION` | 409 | An entry changed meanwhile (`currentRowVersion`) |

Part 5 sheet codes (`SUM_MISMATCH`, `VOTES_INCOMPLETE`, `EXCEEDS_REGISTERED_VOTERS`, ...) also apply inside `changes`.

## Demo data (development and official demos only)

> **WARNING: never run the demo scripts against a real database.** They refuse to run when
> `NODE_ENV=production` or when the database name does not end in `_dev`. They check this before
> opening any connection with write rights. `demo:reset` deletes **everything**: users, audit log,
> every result.

```bash
cd backend
npm run demo:reset                       # dry run: shows what would be wiped
npm run demo:reset -- --commit           # type RESET to confirm: wipe churu_dev + re-run migrations
npm run demo:seed                        # dry run (checks the geography import)
npm run demo:seed -- --commit            # create the demo data (~10 seconds)
```

`demo:seed -- --commit` uses the normal import scripts to create, all clearly marked **DEMO**:
- the real geography from `docs/polling-stations.xlsx`, with `docs/demo/demo-fixes.json` putting
  booth 69 in ZP ward 30 ("DEMO ONLY - not an official decision")
- 5 DEMO parties
- 2–5 `DEMO उम्मीदवार n` candidates per ward, including about 14 unopposed wards
- fake registered-voter counts
- every ballot locked
- 4 demo users with random suffixes: Churu PS_RO, Rajgarh PS_RO, ZP_RO and DM. **Their passwords are
  printed once.**

A final `DEMO_SEED` audit row says "DEMO DATA - not official".

## Public screens: API, live updates and layout (Part 7)

Three media-room TVs show the results:
- **screens 1 and 2:** Panchayat Samitis, as set in the screen layout
- **screen 3:** Zila Parishad

They use a **read-only** public API.

**How it is protected**
- **Before sessions:** `/api/public` sits right after `/api/health`, before sessions. A TV never
  creates or reads a session, never gets a cookie, and an old or expired cookie can't break it.
- **GET only.** Any other method gets 405.
- **Ward-level data only.** Never usernames, officer names, ids of entries, voter counts, lottery notes,
  audit data or internal alarms (a test scans every response).
- **Candidate ids** (`candidateId`) are public and appear only on a shown candidate: each `top3` row,
  `winner`, and `leaderOrWinner`. The screens mark the winner row by id, never by name, because two
  candidates can have the same name.
- **Independent of settings:** it does **not** depend on `public_site_enabled`, which is reserved for a
  future internet-facing site. The screens work without flipping any setting on counting day.

| GET | Returns |
|---|---|
| `/api/public/meta` | `version`, `generatedAt` (IST), `countingDate`, which PS ids are on screens 1 and 2 |
| `/api/public/screens/1`, `/screens/2` | Per Panchayat Samiti (layout order): summary + one card per ward |
| `/api/public/screens/3` | Zila Parishad: summary + ward cards, `partySeats` (ZP) and `psPartySeats` (all PS wards) for the pie charts |
| `/api/public/recent?limit=20` | Latest changed wards (max 50), newest first, with leader or winner |
| `/api/public/winners?limit=20` | Latest declarations (max 50), corrections included, newest first |
| `/api/public/stream` | Server-Sent Events (below) |

**What the ward cards show**
- **Before counting starts:** no leader (empty top 3, no margin).
- **Winner:** shown only once declared, tie-resolved or unopposed.
- **Corrections:** a corrected ward shows `isCorrected: true`.
- **Bad data:** a ward whose data the result engine rejects is shown as `UNAVAILABLE` (an alarm for the
  DM); the other wards keep working.
- **Seat counts** (`won` / `leading` / `total = won + leading`): a tied ward counts for nobody, and
  independents are grouped as निर्दलीय.

**Caching**
- Every response has `Cache-Control: no-store` and `ETag: "<version>"`.
- Sending `If-None-Match` with the current version gets 304.
- The limit is 3,000 requests per minute per IP (`PUBLIC_RATE_LIMIT_PER_MIN`), because the TVs may share
  one IP. These endpoints only read memory.

**The snapshot**
- The server keeps **one complete result snapshot** in memory, built from one consistent database read.
  Requests never query the database.
- **What triggers a rebuild:**
  - after a counting or declare change (changes are collected for 0.5 s)
  - every 60 s anyway, which catches changes made by scripts
  - within ~2 s of a `screens:set`
- **Rate:** two snapshots are never published less than `PUBLIC_MIN_SNAPSHOT_INTERVAL_MS` (default 2 s)
  apart. Changes in between go into the next one; nothing is lost.
- **Failures:** if a rebuild fails, the last good snapshot stays.

**Live updates (SSE): `GET /api/public/stream`**
- It sends `retry: 3000`, then at once an `event: snapshot` with `{"version", "generatedAt"}`, and again
  after every new snapshot.
- It carries **only the version**. A screen that sees a new version fetches its data with the GETs above.
- A heartbeat comment arrives every 15 s.
- At most `SSE_MAX_CONNECTIONS` streams (default 50); after that, new ones get 503 `TOO_MANY_STREAMS`.
- The app adds no compression and sends `X-Accel-Buffering: no`.
- **Behind Caddy (later):** the reverse proxy must not buffer this route. Use
  `reverse_proxy { flush_interval -1 }` for `/api/public/stream`, and keep compression off for it.

```bash
curl -N http://localhost:3000/api/public/stream          # watch versions arrive
curl -s http://localhost:3000/api/public/screens/1 | head -c 600
```

### Screen layout (which PS appears on screen 1 and 2)
- **Storage:** JSON in `app_settings.screen_layout`.
- **Defaults** (in this order):
  - Screen 1: Churu, Churu North HQ Churu, Sardarshahar, Sardarshahar East, Taranagar East,
    Taranagar West (Bhaleri) HQ Taranagar, Ratangarh.
  - Screen 2: Sujangarh, Bidasar, Bhanipura, Rajgarh, Chandgothi HQ Rajgarh, Siddhmukh.
- Screen 3 is always Zila Parishad.

```bash
npm run screens:show
npm run screens:set -- --file layout.json             # dry run: checks the file
npm run screens:set -- --file layout.json --commit    # saves (audited); screens update within ~2 s
```
`layout.json` is `{"1": ["CHURU PANCHAYAT SAMITI", ...], "2": [...]}`. The names must be exactly as
imported (case is ignored). All 13 Panchayat Samitis must appear exactly once across screens 1 and 2.

### Demo simulation (development and official demos only)
`npm run demo:simulate` plays a counting day on the `*_dev` database through the **real** HTTP API
(login, CSRF, booth entry, postal, declare), as the demo RO accounts. It refuses to run in production
or on any database whose name doesn't end in `_dev`. Passwords come from environment variables, never
files: use the ones `demo:seed` printed.

```bash
export DEMO_RO_CHURU_PASSWORD='...' DEMO_RO_RAJGARH_PASSWORD='...' DEMO_ZP_RO_PASSWORD='...'
npm run demo:simulate -- --ps all-demo --speed slow --declare --ties    # type SIMULATE (or add --yes)
```

| Option | Meaning |
|---|---|
| `--ps CHURU\|RAJGARH\|all-demo` | Which demo PS_RO(s) count (default `all-demo`) |
| `--zp` | Also let the demo ZP_RO count the ZP ballots (1,359 booths) |
| `--speed slow\|normal\|fast` | ~3 s per booth (to watch the screens), ~0.5 s, or no delay |
| `--declare` | Declare each ward once all booths and postal are in |
| `--ties` | Make about one ward in seven tied at the top; it is settled by lottery when declaring |
| `--yes` | Skip the confirmation |

Votes are random but valid: they add up to the sheet total and stay under the registered voters. The
server must be running (`DEMO_API_URL`, default `http://localhost:3000`). Ctrl+C stops cleanly after
the current request.

## Operator dashboard (Part 8)

The Hindi dashboard for the PS and ZP Returning Officers lives in `frontend/` (React + Vite + TypeScript).
In production it is a static build that the backend serves itself, on the same origin as the API, under the
same strict CSP. Everything is self-hosted: no CDN, no Google Fonts, no internet needed on counting day. The
font is Noto Sans Devanagari (official v2.007 TTF, OFL licence) in `frontend/src/assets/fonts/`.

**Who sees what**
- **PS_RO / ZP_RO:** their wards, booth entry, edit, void, postal, history, declare, correction.
- **DM:** the read-only reports (Part 10, "DM reports" below); never any entry or declare action.
- **Wrong ward or entry:** a direct URL to another PS's ward or entry shows "अनुमति नहीं".

### Development (two terminals)

```bash
# terminal 1: API on :3000 (backend/.env: APP_ORIGIN=http://localhost:5173)
cd backend && npm run dev
# terminal 2: dashboard with hot reload on http://localhost:5173 (proxies /api to :3000)
cd frontend && npm ci && npm run dev
```

The Vite proxy keeps the browser's `Origin: http://localhost:5173`, so `APP_ORIGIN` must be exactly that in
development. The production Origin check is not relaxed for this.

### Production (one process)

```bash
npm run build      # repo root: frontend build (with the CSP check) + backend build
npm start          # repo root: backend on PORT, serving frontend/dist and /api
```

Equivalent by hand: `cd frontend && npm ci && npm run build`, then `cd backend && npm ci && npm run build && npm start`.

If `PORT` is already in use (for example an old `npm run dev` is still running), the server refuses to
start: it prints "Cannot start: port N is already in use" and exits with code 1. Stop the other process
(`ss -ltnp | grep :3000` shows it) and start again. Otherwise the browser would be talking to the old
process.

**Configuration**
- **Where the build is:** the backend serves the build from `FRONTEND_DIST`, default `../frontend/dist`,
  relative to `backend/`. If it does not exist, only the API runs, and startup says so.
- **`APP_ORIGIN`:** must be the exact address operators type in the browser, scheme and port included. For
  example `http://192.168.1.10:3000`, or the Caddy HTTPS URL. Otherwise every save gets `ORIGIN_REJECTED`.
- **Counting day must be HTTPS** (Caddy in front, later part). With `NODE_ENV=production` the session cookie
  is `Secure`, so it is never sent over plain http, and HSTS is on. Plain http works only in development and
  in the e2e tests (`NODE_ENV=test`).

**How the build is served**
- **Which requests:** only GET/HEAD for paths outside `/api`. Unknown paths get `index.html`, so the
  browser's routes work on reload.
- **Caching:** `/assets/*` files have content hashes in their names: `Cache-Control: public, max-age=31536000,
  immutable`. `index.html` gets `no-cache`, so a new build is picked up at once.
- **No session:** static files are served before the session middleware, so they never create a session or
  set a cookie.
- **CSP:** the build has no inline script or style and no `data:` or external URLs; Vite's asset inlining is
  off. `npm run build` runs `scripts/check-csp.mjs`, which fails the build if any of these appear.

### Using it (operator's view)
1. **Log in.** The page goes to मेरे वार्ड (refreshes every 15 s; filter by ward number), then open a ward.
2. **Booth entry.** Type the round, then each candidate's votes in ballot order (NOTA last), then the sheet
   total ("कुल योग").
   - **Enter** moves to the next field. Enter on the total is "आगे".
   - **Live line:** "आपका जोड़ / पर्ची का योग" shows ✓ बराबर (green) or ✗ बराबर नहीं (red), always with text.
   - **Empty is not 0:** type 0 for zero.
   - **Only whole numbers:** minus, decimals, "e", spaces, paste of other text and the mouse wheel are all
     blocked.
3. **Confirm.** "आगे" shows a confirm screen with exactly the typed numbers and the ward totals after saving.
   "पुष्टि करें और सेव करें" saves once; a double click does not save twice. After saving, the ward page
   highlights the next booth.
4. **Leaving with typed numbers** asks first: in-page for links, and the browser's warning for reload/close.
   Dialogs are native modal `<dialog>`s: above everything, the page behind is inert, Tab stays inside, and
   Esc means "stay".
5. **Edit / void.**
   - Both need a reason: pick a standard reason from the list and add details ("अन्य" needs details).
   - An edit that changes nothing is stopped: "कोई बदलाव नहीं — सुधार की ज़रूरत नहीं".
   - Edit shows old vs new before saving.
   - "इतिहास" on a booth row (and on the postal section) shows the whole story, voided entries included.
   - If someone else changed the entry meanwhile: "किसी और ने इसे बदल दिया है, पेज दोबारा खोलें".
   - After a void, the booth can be entered again.
6. **Postal.** The same sheet, plus rejected postal votes, which are shown separately and are not in the sum.
7. **Declare / correction.**
   - Shows the result table, winner, margin and total valid votes.
   - **Tie:** the lottery result is entered; the system never picks a winner.
   - **NOTA highest:** needs the acknowledgement box.
   - **Password re-check:** the password is cleared after each try.
   - **If the result changed meanwhile:** it shows the fresh result and asks again.
   - **Correction:** lists all declaration versions and creates version N+1.

**Security in the browser**
- **CSRF token:** kept only in memory; never in localStorage, sessionStorage or cookies readable by script.
  On `CSRF_FAILED` the client fetches a new token and retries once.
- **Session lost:** any 401 (`SESSION_EXPIRED` / `UNAUTHENTICATED`) clears the state and returns to the
  login page with the reason.
- **Last round used:** remembered only in memory, per tab.

### Frontend scripts (in `frontend/`)

| Script | What it does |
|---|---|
| `dev` | Vite dev server on :5173 (proxy `/api` → :3000) |
| `build` | typecheck + production build + CSP check (`scripts/check-csp.mjs`) |
| `test` | Vitest unit/component tests (jsdom) |
| `e2e` | build, then Playwright (Chromium) against the build served by the real backend on `churu_test` |
| `lint` / `typecheck` / `format` | ESLint / `tsc --noEmit` / Prettier |

**E2E setup**
- **Browser:** install once with `npx playwright install chromium`.
- **Server:** `npm run e2e` starts the backend itself on port 3199 with `DB_NAME=churu_test`,
  `NODE_ENV=test` and `APP_ORIGIN=http://localhost:3199`. Do not run it at the same time as the backend
  tests; they share `churu_test`.
- **Data:** `backend/tests/e2e-support/seed-e2e.ts` empties `churu_test` and builds one ward per scenario.
  Entries go through the real API. It refuses any database whose name does not end in `_test`.
- **Session expiry:** `expire-sessions.ts` simulates it by ageing or deleting one user's session rows.
- **CSP:** every e2e test fails on any Content-Security-Policy violation in the browser.

### All error codes (`{"error": CODE}`) and what the dashboard shows

| Code | HTTP | Dashboard message |
|---|---|---|
| `VALIDATION_FAILED` | 400 | भरी गई जानकारी सही नहीं है, कृपया जाँचें (on the login page: गलत यूज़रनेम या पासवर्ड) |
| `INVALID_CREDENTIALS` | 401 | गलत यूज़रनेम या पासवर्ड |
| `UNAUTHENTICATED` | 401 | कृपया दोबारा लॉगिन करें (→ login page) |
| `SESSION_EXPIRED` | 401 | सत्र समाप्त, दोबारा लॉगिन करें (→ login page) |
| `REAUTH_FAILED` | 401 | पासवर्ड गलत है |
| `CSRF_FAILED` | 403 | सुरक्षा जाँच विफल, पेज दोबारा खोलें (after one automatic retry) |
| `ORIGIN_REJECTED` | 403 | यह पेज गलत पते से खुला है, सही पते से खोलें |
| `FORBIDDEN` | 403 | आपको यह काम करने की अनुमति नहीं है (ward/entry pages: "अनुमति नहीं") |
| `NOT_FOUND` | 404 | जानकारी नहीं मिली |
| `METHOD_NOT_ALLOWED` | 405 | यह काम यहाँ नहीं हो सकता |
| `ACCOUNT_LOCKED` | 423 | खाता अस्थायी रूप से बंद है, N मिनट बाद प्रयास करें |
| `TOO_MANY_REQUESTS` | 429 | बहुत अधिक प्रयास, थोड़ी देर बाद फिर प्रयास करें |
| `SNAPSHOT_UNAVAILABLE` | 503 | परिणाम अभी उपलब्ध नहीं हैं |
| `TOO_MANY_STREAMS` | 503 | बहुत अधिक स्क्रीन जुड़ी हैं |
| `BOOTH_NOT_IN_WARD` | 400 | यह बूथ इस वार्ड का नहीं है |
| `VOTES_INCOMPLETE` | 400 | हर उम्मीदवार (नोटा सहित) के मत भरें |
| `UNKNOWN_CANDIDATE` | 400 | उम्मीदवार इस वार्ड का नहीं है |
| `DUPLICATE_CANDIDATE` | 400 | एक उम्मीदवार दो बार भरा गया है |
| `SUM_MISMATCH` | 400 | मतों का जोड़ (sum) पर्ची के योग (sheetTotal) से मेल नहीं खाता |
| `EXCEEDS_REGISTERED_VOTERS` | 400 | योग बूथ के पंजीकृत मतदाताओं से अधिक है (both numbers shown) |
| `VOTER_COUNT_MISSING` | 409 / warning | इस बूथ की मतदाता संख्या दर्ज नहीं है |
| `BALLOT_NOT_LOCKED` | 409 | इस वार्ड की उम्मीदवार सूची अभी लॉक नहीं है |
| `WARD_UNOPPOSED` | 409 | यह वार्ड निर्विरोध है, मतगणना नहीं होगी |
| `WARD_DECLARED` | 409 | वार्ड घोषित हो चुका है; बदलाव केवल संशोधन से होगा |
| `ALREADY_ENTERED` | 409 | यह बूथ/डाक मत पहले ही दर्ज हो चुका है |
| `STALE_VERSION` | 409 | किसी और ने इसे बदल दिया है, पेज दोबारा खोलें |
| `ALREADY_DECLARED` | 409 | यह वार्ड पहले ही घोषित है |
| `COUNTING_INCOMPLETE` | 409 | सभी बूथ और डाक मत दर्ज नहीं हुए (counts shown) |
| `RESULT_CHANGED` | 409 | परिणाम बदल गया है, कृपया दोबारा जाँचें (fresh result shown) |
| `NOTA_HIGHEST_ACK_REQUIRED` | 409 | नोटा को सर्वाधिक मत — पुष्टि का बॉक्स चुनें |
| `NOT_DECLARED` | 409 | यह वार्ड अभी घोषित नहीं है |
| `LOTTERY_REQUIRED` | 400 | बराबरी है — लॉटरी का परिणाम भरें |
| `LOTTERY_NOT_ALLOWED` | 400 | बराबरी नहीं है, लॉटरी की आवश्यकता नहीं |
| `LOTTERY_WINNER_NOT_TIED` | 400 | लॉटरी विजेता बराबरी वाले उम्मीदवारों में से होना चाहिए |
| `ENTRY_NOT_IN_WARD` | 400 | यह एंट्री इस वार्ड की नहीं है |
| `DUPLICATE_CHANGE` | 400 | एक ही एंट्री दो बार चुनी गई है |
| `NO_CHANGE` | 400 | कोई बदलाव नहीं — सुधार की ज़रूरत नहीं (identical edit, or a correction equal to the declaration) |

Fallbacks:
- Express's own `Not found` / `Bad request` / `Payload too large` / `Internal error` bodies get Hindi text too.
- A network failure shows "सर्वर से संपर्क नहीं हो सका — नेटवर्क जाँचें".
- Any code not in this list shows "कुछ गड़बड़ हुई (CODE)".

`frontend/src/test/errors.test.ts` fails if any code in the backend source or in a README error table has
no Hindi message.

## TV screens (Part 9)

Three full-screen pages for the media-room TVs, in the same build as the dashboard and served by the
same backend. They are **public**: no login, no cookie, and they never call `/api/auth`.

| URL | Shows |
|---|---|
| `/screen/1` | Panchayat Samitis of screen 1, in the screen-layout order (`npm run screens:show`) |
| `/screen/2` | Panchayat Samitis of screen 2 |
| `/screen/3` | Zila Parishad: ward cards on the left; on the right, a pie of ZP seats won, the ZP party table (जीते / आगे / कुल), the latest winners, and a table for all PS wards together |

Open each in Chrome kiosk mode, or press F11, e.g. `http://192.168.1.10:3000/screen/1`. Any other screen number
shows a Hindi message.

**Layout**
- **Size:** designed for 1920×1080 and scaled to any window with one CSS transform; there are never any
  scrollbars. The mouse cursor hides after 3 s without movement.
- **Header:** two groups. On the left, the title and screen name. On the right, the chip "घोषित X / Y"
  (X = declared + lottery + unopposed wards, Y = all wards on the screen; on screen 3 the ZP wards),
  a "लाइव" dot, and "अंतिम अपडेट HH:MM:SS". The time comes from the server's snapshot (`generatedAt`, IST), not from the laptop's clock.
- **"अभी बदला":** one static row with the 3 newest changes, each a short sentence with the short Hindi
  PS name (or ज़िला परिषद), e.g. "राजगढ़ · वार्ड 9 · विजयी: <name> (<party>)" or
  "चूरू · वार्ड 8 · मतगणना जारी — आगे: <name> (<party>)". Text is cut only between words; if the row
  is too narrow, the 3rd item is dropped. Nothing scrolls.
- **Pages:** one PS per page in layout order, titled "<Hindi name> पंचायत समिति" with the summary
  chips (घोषित, निर्विरोध, मतगणना जारी, शुरू नहीं). There are up to 8 cards per page (4×2); ZP has 6 per page (3×2), so the top 3 with two-line
  names fit at full size.
  A PS with more wards is split evenly into sub-pages ("रतनगढ़ पंचायत समिति 1/3").
- **Timing:** pages change every **15 s**; `?interval=SECONDS` sets another value between 5 and 120
  (e.g. `/screen/1?interval=30`). A page where **every** ward is शुरू नहीं / उम्मीदवार सूची बाकी stays
  only 5 s. The footer shows page dots and "अगला: …".
- **Grid:** the rows stretch to fill the height down to the footer; with fewer rows the text is a
  little larger.
- **Cards:** ward order is unchanged. A card whose data changed has an amber outline for 3 s.

| Card status | Shows |
|---|---|
| Card status (badge) | Colour (top stripe + badge) | Shows |
|---|---|---|
| शुरू नहीं / उम्मीदवार सूची बाकी | grey; light-grey "quiet" card | only "मतगणना शुरू नहीं" / "उम्मीदवार सूची बाकी" (no names, no numbers) |
| मतगणना जारी / घोषणा बाकी | blue | top 3 rows, then "आगे X मत" or "बराबर", and "बूथ a/b · राउंड r · नोटा n · डाक ✓" |
| बराबर — लॉटरी बाकी | amber | top 3 and "बराबर"; nobody is marked as winner |
| विजयी | green | top 3; the winner row is light green, bold, and starts with "✓". Also "अंतर X मत" |
| विजयी (लॉटरी) | purple | as विजयी, for the **lottery** winner (picked by candidate id); "अंतर 0 मत (लॉटरी से)" |
| निर्विरोध निर्वाचित | teal | the badge once; the body shows "✓ name" and party; no vote numbers |
| उपलब्ध नहीं | red | text only |
| + संशोधित | amber badge | the declaration was corrected |

- **Candidate rows:** every row has the same structure: a thin bar in the party colour (निर्दलीय
  grey); the name (bold for the winner or the leader) with the party on its own line under it; the
  votes in a fixed right-aligned column (tabular digits, so numbers line up across rows and cards).
  Names wrap to two lines and only then end with "…"; the winner's name is never cut.
- **Inside a card:** content flows top to bottom (title, rows, then "आगे/अंतर" directly under the
  rows, then the meta line); spare height stays at the bottom. Spacing is 8/16/24 px, with three
  text sizes per card.
- **Screen 3 right side:** three white panels: "जीती सीटें" (pie with the legend beside it, and the
  table), "नवीनतम विजेता" (as many of the newest as fit), and "सभी पंचायत समितियाँ".
- **Layout test:** `frontend/e2e/screens-layout.spec.ts` checks every page of every screen at
  1920×1080 and 1366×768: nothing overflows its box, row and header parts never overlap, the vote
  numbers line up, and there are no scrollbars.
- **Numbers:** Western digits with Indian grouping (1,23,456).

**Colours:**
- **Where they are defined:** all of them are CSS variables in `frontend/src/styles/screens.css`.
- **Base:** page #E8EEF5 (blue-grey), header #0B3D91, cards white.
- **The "अभी बदला" row:** light amber with dark amber text.
- **Contrast:** a unit test checks that every text colour meets WCAG AA (4.5:1) against its
  background.
- **Never colour alone:** a colour always goes with its text.

**Hindi PS names**
- **Where they come from:** the screens use each Panchayat Samiti's **short** Hindi name (`रतनगढ़`) and
  add "पंचायत समिति" where a full title is needed. Without a Hindi name they show the English name.
- **Setting or changing them:**

  ```bash
  npm run ps:set-hindi-names -- --file ../docs/ps-names.json            # dry run: shows old -> new
  npm run ps:set-hindi-names -- --file ../docs/ps-names.json --commit   # saves
  ```

  The file is `{ "<English PS name as imported>": "<short Hindi name>" }`; case and extra spaces in
  the English name are ignored.
- **All or nothing:** an unknown name, an empty or non-Hindi value, or a Hindi name used twice
  writes nothing.
- **What it writes:** only `panchayat_samiti.name_hindi` (never wards, booths, candidates or
  entries), plus one `PS_HINDI_NAMES_SET` audit row. It is therefore safe even after counting has
  started. The screens show the new names within about a minute.
- **The names in `docs/ps-names.json` are PROVISIONAL** and must be confirmed by the election
  officials before counting day. `demo:seed` applies them too.

**Party colours**
- **Where they are set:** `frontend/src/screens/partyColours.ts`, a fixed map from short name to
  colour, used for the bar on each card row and on screen 3's pie and tables. **Edit it before
  counting day** to match the imported party short names.
- **Other parties:** parties not in the map get a palette colour in the sorted order of their short names.
- **Independents:** निर्दलीय is grey.
- **Never colour alone:** a colour always appears next to the party name.

**Live updates and the red banner**
- **How updates arrive:** on load a screen fetches `/api/public/meta`, `/screens/N` and `/recent`
  (plus `/winners` on screen 3). It then listens to `/api/public/stream`. On every snapshot event with
  a different version, it refetches with `If-None-Match` (304 = keep the data). If no event arrives
  for 70 s, it refetches anyway.
- **When the red banner appears:** "कनेक्शन टूटा — अंतिम अपडेट HH:MM:SS (पुराना डेटा)" shows across
  the screen when any of these happens:
  - the stream has been disconnected for more than 10 s
  - a fetch fails
  - no new snapshot version has arrived for 150 s although the stream looks connected (the server
    publishes at least every 60 s, so this catches a stuck server)
- **While the banner shows:** the last data stays on screen, the "लाइव" dot turns red with "लाइव
  नहीं", and the screen retries every 5 s and reconnects by itself.
- **When it goes:** only when fresh data has actually arrived.
- **Before any data:** "डेटा लोड हो रहा है…". While the server has no snapshot yet (503
  `SNAPSHOT_UNAVAILABLE`), it shows "परिणाम अभी तैयार हो रहे हैं…" and retries every 5 s.
- **A broken card:** a rendering error in one card shows that card as "उपलब्ध नहीं"; the rest of the
  screen keeps working.

## DM reports (Part 10)

The DM logs in and lands on **`/reports`**, a read-only dashboard in Hindi (`/dm` redirects there).
- **Nothing to change:** there is no entry, edit, declare or correction button for the DM anywhere.
  The server enforces this too: `/api/reports` is DM only, and the global DM guard refuses every write.
- **Other roles:** a PS_RO or ZP_RO opening `/reports` or `/dm` sees "अनुमति नहीं", and the API answers
  403 (401 when logged out).

**On the page**
- **Alarms first:** a red box when any of these exist, otherwise a green "कोई चेतावनी नहीं":
  - a declared ward whose votes no longer match its declaration (`declarationMismatch`)
  - a ward whose data the result engine refuses (`UNAVAILABLE`)
  - the voter-count check running disabled: a `CONFIG_VOTER_CHECK_DISABLED` startup audit row exists
    **and** the running server has `REQUIRE_VOTER_COUNTS=false`
  - a declared ward where NOTA had the most votes
- **Filter:** सभी पंचायत समितियाँ (all PS together), each Panchayat Samiti, ज़िला परिषद. Alarms are
  always district-wide.
- **Refresh:** every 30 s; "अंतिम अपडेट" is the server's time of the data.

| Section | How it is counted |
|---|---|
| प्रगति | wards: total / declared (incl. lottery) / unopposed / counting / not started (and no-candidate / unavailable if any); booths entered / total; postal entered / needed |
| पार्टीवार सीटें | won = declared + lottery + unopposed; leading = untied leader of a counting ward; independents as निर्दलीय (the same rule as the TV screens) |
| महिला विजेता | winners (declared, lottery or **unopposed**) whose candidate gender is F: by party and listed |
| आरक्षण वर्ग | per `reservation_category`: wards, decided, women winners (hidden when no ward has a category) |
| नोटा | total NOTA votes (and share of valid votes); wards where NOTA had the most votes |
| नज़दीकी मुकाबले | **declared** wards with margin ≤ 100 votes **or** ≤ 1% of valid votes (NOTA included), smallest margin first |
| लॉटरी से निर्णय | wards decided by lottery: winner, tied votes, who conducted it, the note, who declared and when |
| संशोधन | every correction (version > 1): old and new winner, reason, who, when |
| मतदान प्रतिशत | valid votes / registered voters, only over fully counted wards whose every booth has a voter count; otherwise "डेटा उपलब्ध नहीं" |

**Ward detail and print**
- **Ward detail** (`/reports/wards/:id`, from any ward link):
  - candidates with booth / postal / total votes (gender shown, the winner marked)
  - the booth-wise votes as entered, with who entered them and when, and the number of edits and voids
  - the postal entry
  - every declaration version, with the lottery details, the NOTA acknowledgement and the correction reason
- **Print** ("प्रिंट करें"): A4, no buttons or filter, each section on a new page, the page number and
  the print time in the footer.

**CSV** ("CSV डाउनलोड" per section)
- **Endpoint:** `GET /api/reports/export.csv?section=<alarms|progress|party-seats|women|reservation|nota|close-contests|lottery|corrections|turnout>[&scope=ALL_PS|ZP|PS:<id>]`.
- **Format:** UTF-8 with a BOM, so Excel shows Hindi correctly. Every cell is quoted, and text starting
  with `= + - @` gets a leading `'` (CSV-injection safe).
- **File name:** `report-<section>-YYYYMMDD-HHMMSS-IST.csv`.
- **Audit:** each export writes a `REPORT_EXPORTED` audit row (section, scope, user, IP). Viewing is not
  audited.

**API**
- **`GET /api/reports/summary`:** built from **one** read-only consistent snapshot with a fixed
  number of queries, and cached for 5 s.
- **`GET /api/reports/wards/:wardId`:** the ward detail.
- **The numbers:** all vote numbers come from the result engine (`result.ts`).

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
