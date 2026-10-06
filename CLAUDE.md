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
- Database: MySQL 8 (InnoDB, utf8mb4, timezone Asia/Kolkata), via `mysql2/promise`, raw SQL with prepared statements (`execute`) only. No ORM.
- Migrations: Knex migrations (schema only)
- Validation: Zod on every request body, query and param
- Auth: express-session + express-mysql-session, bcrypt (cost 12)
- Security: helmet, express-rate-limit, CSRF protection
- Live updates: Server-Sent Events (SSE)
- Frontend: React + Vite + TypeScript, plain CSS. UI labels in Hindi, code in English.
- Tests: Vitest + Supertest against a real MySQL test database in Docker (never mock the DB for business logic tests)
- Packaging: Docker + docker-compose

## Domain facts
- 13 Panchayat Samitis, 231 PS wards, 39 ZP wards, 1,359 booths.
- Booth identity = (Panchayat Samiti + booth number). Booth numbers restart in every PS.
- Each booth belongs to exactly one PS ward and one ZP ward. 9 ZP wards span more than one PS.
- Each booth has two ballots: PS and ZP (`ballot_for` = 'PS' | 'ZP').
- Exactly 15 logins: 13 `PS_RO` (one per PS), 1 `ZP_RO`, 1 `DM`. No other roles exist.
- `PS_RO` can only touch PS ballots of booths in their own PS. `ZP_RO` can only touch ZP ballots (all PS). `DM` is read-only (reports only).
- Setup work (imports, creating users) is done by CLI scripts on the server, never through a web login.
- Nobody enters data from EVMs directly. Counting officials approve a result sheet (parchi); the RO types it into the system.

## Correctness rules (non-negotiable)
1. All result math (totals, leader, margin, top-3, tie) lives ONLY in `backend/src/services/result.ts`. Nothing else adds votes.
2. NOTA is never a winner, leader or runner-up. Margin is computed between candidates only.
3. Equal top votes = status `TIE`. The system never picks a winner on a tie; the RO records the lottery result.
4. One entry per (booth, ballot_for), enforced by a UNIQUE constraint in the database.
5. Votes are integers >= 0 (DB CHECK + Zod).
6. Sum of (candidates + NOTA) must equal the sheet total the RO types. Otherwise reject.
7. Booth total must not exceed the booth's registered voters.
8. A ward can be declared only when all its booths and its postal ballots are entered.
9. Before declare, an entry can be edited only with a reason; old values go to the audit log.
10. After declare, numbers change only through a new correction version with a reason. Old versions are kept forever.
11. Every write runs inside a single DB transaction. No partial saves.
12. `audit_log` is append-only: the app DB user has only INSERT/SELECT on it, and triggers block UPDATE/DELETE.
13. Public screens show only saved, valid data, plus a "last updated" time.

## Security rules (non-negotiable)
- Only parameterized SQL. Never build SQL from user input (including column/table names).
- Authorization is checked on the server for every request, including ownership (which PS/ballot the user may touch). Hiding a button is not security.
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
