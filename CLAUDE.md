# Churu ZP-PS Election Results Portal

Official results portal for Churu district (Rajasthan) Panchayat elections:
Zila Parishad (ZP) and Panchayat Samiti (PS) members, ward-wise results.
Counting day: 20 November 2026. This is election data for the government.
**A wrong number on screen is a critical failure. Correctness and security beat speed and features.**

## How we work
- The project is built in numbered parts. Work ONLY on the part named in the current prompt.
- Always start with a plan. Do not write code until the plan is approved.
- Never change the database schema, an earlier part's code, or any existing test outside the current part without asking first.
- Never delete, skip, or weaken a test to make it pass. If a test seems wrong, stop and explain.
- A part is done only when `npm test` passes, `npm run lint` and `npm run typecheck` are clean, and you have written a short "How to test manually" list.
- If something is unclear, ask. Do not guess about election rules.

## Fixed stack (do not change without asking)
- Backend: Node.js 24 LTS, Express, TypeScript (strict, no `any`)
- Database: MySQL 8.4 LTS (InnoDB, utf8mb4, timezone Asia/Kolkata), via `mysql2/promise`, raw SQL with prepared statements (`execute`) only. No ORM.
- Migrations: Knex migrations (schema only)
- Validation: Zod on every request body, query and param
- Auth: express-session + express-mysql-session, bcrypt (cost 12)
- Security: helmet, express-rate-limit, CSRF protection
- Live updates: Server-Sent Events (SSE)
- Frontend: React + Vite + TypeScript, plain CSS. UI labels in Hindi, code in English.
- Tests: Vitest + Supertest against a real MySQL test database in Docker (never mock the DB for business logic tests)
- Packaging: Docker + docker-compose

## Domain facts
- 13 Panchayat Samitis, 231 PS wards, 39 ZP wards, 1,371 booths: 1,359 numeric + 12 "A" booths such as 15A (Nov 2026 file `new data/Geography_FULL_1371.xlsx`).
- Booth identity = (Panchayat Samiti + booth_no + booth_suffix). Booth numbers restart in every PS. `booth_suffix` is VARCHAR(2) NOT NULL DEFAULT '' (capital letters only, '' = plain booth; never NULL, so the UNIQUE key works). Always sort by `booth_no, booth_suffix` (12, 12A, 13).
- Booth numbers go through `backend/src/services/booth-no.ts` only: `parseBoothNo` (12 / "12A" in; anything else is refused), `boothLabel` / `boothLabelOf` (DB row -> "12A"; throws if booth_suffix was not selected), `compareBoothNo` (sort). The API `boothNo` is always the string label ("12", "12A"), never a number; every query that shows a booth number must select `booth_suffix`.
- Each booth belongs to exactly one PS ward and one ZP ward. 8 ZP wards span more than one PS (25, 27, 28, 30, 32, 36, 37, 39 in the Nov 2026 geography file).
- Each booth has two ballots: PS and ZP (`ballot_for` = 'PS' | 'ZP').
- There are no rounds (DEO order, Nov 2026; removed by migration `20261023000001_remove_round_no`). Counting progress is booths entered / total booths of the ward ("4 / 50"): entered = the booth has a live (not voided) entry for the ward's ballot; a ZP ward counts every booth in every PS. Postal ballots are shown next to it, never inside it. Count it ONLY via `backend/src/services/booth-progress.ts`; show it via `boothProgress()` in `frontend/src/components/format.ts`.
- Exactly 15 election logins: 13 `PS_RO` (one per PS), 1 `ZP_RO`, 1 `DM`, plus ONE `SUPER_ADMIN` setup login (created once by `users:create`). No other roles exist.
- `SUPER_ADMIN` can use only `/api/superadmin` (setup panel: DM account reset/unlock/email, clear candidates, full reset, booth add/delete, counting lock) — never counting, reports or DM tools. While the counting lock is ON, clear candidates, full reset and booth add/delete are refused for everyone.
- `PS_RO` can touch PS ballots of booths in their own PS, and (Part 14, one parchi carries both) create/edit/void the ZP-ballot booth entries of booths in their own PS. Official order: the postal ballots of each ZP ward are entered ONLY by the PS_RO of the PS assigned in `zp_ward_postal_assignment` (set by `npm run zp-postal:set-default -- --commit` after geography + candidates). Never ZP declare, ZP lottery or ZP correction, never after the ZP ward is declared, and never ZP ward totals or leader. `ZP_RO` enters NO booth or postal sheet (create/edit/void = 403); it reads ZP wards (progress by PS), declares and corrects them, and sees ZP reports (Part 2 / Format 7, ST format, Counting Status Report limited to ZP wards on the server). `DM`: reports, plus the Part 13 admin tools only (parties/candidate upload, lock, RO management, booth/ward details before counting). The DM can never enter votes, edit/void entries, declare or correct.
- Candidate name correction after the ballot lock ("नाम सुधारें", Nov 2026): once a ward is locked (also while counting and after it is declared) the ONLY change allowed to its candidates is the NAME (`candidate.name_hindi`, the only name column); party, symbol, order, gender, details, add/remove and NOTA stay frozen. Only the PS_RO for PS wards of their own PS and the ZP_RO for ZP wards may do it (the ZP_RO's only write besides candidate lists before the lock, declare and correction; it still enters no booth or postal sheet). DM and SUPER_ADMIN get 403. Every correction needs a reason (10-500 characters) and the RO's own password again (`requireReauth`, counted toward the login lockout), compares the name the RO saw (compare-and-set), and writes the candidate UPDATE, an append-only `candidate_name_change` row and an `audit_log` row in ONE transaction. Code: `backend/src/services/candidate-name.ts` (name rules) and `backend/src/modules/candidates/name-change.service.ts`. History: the RO sees their own wards; the DM sees all (and the CSV); the Super Admin sees none. Before the lock the normal list edit is unchanged.
- Setup work (imports, creating users) is done by CLI scripts on the server, or by the DM's admin pages (/api/admin) with password re-entry and audit.
- Nobody enters data from EVMs directly. Counting officials approve a result sheet (parchi); the RO types it into the system.

## Correctness rules (non-negotiable)
1. All result math (totals, leader, margin, top-3, tie) lives ONLY in `backend/src/services/result.ts`. Nothing else adds votes.
2. NOTA is never a winner, leader or runner-up. Margin is computed between candidates only.
3. Equal top votes = status `TIE`. The system never picks a winner on a tie; the RO records the lottery result.
4. One entry per (booth, ballot_for), enforced by a UNIQUE constraint in the database.
5. Votes are integers >= 0 (DB CHECK + Zod).
6. Sum of (candidates + NOTA) must equal the sheet total the RO types. Otherwise reject.
7. Registered voters are NOT checked (official order): no refusal or warning for a missing voter count or a total above it, and entry never needs a voter count. (The voter columns and the optional voter import stay, for reports.)
8. A ward can be declared only when all its booths and its postal ballots are entered.
9. Before declare, an entry can be edited only with a reason; old values go to the audit log.
10. After declare, numbers change only through a new correction version with a reason. Old versions are kept forever.
11. Every write runs inside a single DB transaction. No partial saves.
12. `audit_log` is append-only: the app DB user has only INSERT/SELECT on it, and triggers block UPDATE/DELETE. The same holds for `ward_declarations`, `voided_entry` and `candidate_name_change`.
13. Public screens show only saved, valid data, plus a "last updated" time.

## Security rules (non-negotiable)
- Only parameterized SQL via execute(). query() is allowed only for fixed SQL text with no user input (e.g. transaction control like START TRANSACTION). Never build SQL from user input (including column/table names).
- Authorization is checked on the server for every request, including ownership (which PS/ballot the user may touch). Hiding a button is not security.
- Passwords are bcrypt-only, with ONE approved exception: PS_RO/ZP_RO accounts also keep an AES-256-GCM encrypted copy (`users.password_enc`, key `RO_PASSWORD_KEY` from env) so the DM can view it after re-entering their own password (audit-logged, never logged in clear). The DM account never has a copy; login uses the bcrypt hash only.
- Session cookie: HttpOnly, SameSite=Strict, Secure in production. Regenerate session on login, destroy on logout, idle timeout 30 min.
- Login: rate limit + account lockout after repeated failures. Generic error message ("galat username ya password").
- CSRF protection on every state-changing request.
- helmet with a strict Content-Security-Policy. CORS locked to our own origin.
- Secrets only in `.env` (never committed). Validate env with Zod at startup and fail fast.
- Errors to clients never include stack traces, SQL, or internal details. Log details server-side without passwords or session ids.
- The app DB user has least privilege (no DROP/ALTER/CREATE). Migrations use a separate user.
- Public API is read-only and has no write endpoints.
- No new npm dependency without saying why; prefer well-known packages. Run `npm audit` at the end of each part.

## Folder structure
```
backend/
  src/
    config/        # env, db pool
    middleware/    # auth, role/ownership checks, rate limit, csrf, audit, errors
    modules/       # auth, master, counting, declare, reports, public
    services/      # result.ts and other pure logic
    db/migrations/
  scripts/         # imports, user creation, backup
  tests/
frontend/
  src/pages/
docs/              # database.sql, Excel files, roadmap (reference only)
```
