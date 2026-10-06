// npm run demo:simulate -- [--ps CHURU|RAJGARH|all-demo] [--zp] [--speed slow|normal|fast] [--declare] [--ties] [--yes]
//
// DEVELOPMENT / OFFICIAL DEMO ONLY. Simulates a counting day on the *_dev database through the
// REAL HTTP API (login, CSRF, counting, declare) as the demo RO accounts created by demo:seed.
// Passwords come from environment variables, never from files:
//   DEMO_RO_CHURU_PASSWORD, DEMO_RO_RAJGARH_PASSWORD, DEMO_ZP_RO_PASSWORD
// The server must be running (DEMO_API_URL, default http://localhost:3000).
import { randomInt } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import dotenv from 'dotenv';
import type { RowDataPacket } from 'mysql2/promise';
import { createPool } from '../src/config/db.js';
import { parseEnv } from '../src/config/env.js';
import { isMainModule, parseCli } from './lib/cli.js';
import { assertDemoEnvironment } from './lib/demo-guard.js';
import { scriptEnvSchema } from './lib/env.js';

type Speed = 'slow' | 'normal' | 'fast';
const DELAY_MS: Record<Speed, number> = { slow: 3000, normal: 500, fast: 0 };

const ACTORS = {
  CHURU: {
    role: 'PS_RO',
    ps: 'CHURU PANCHAYAT SAMITI',
    passwordVar: 'DEMO_RO_CHURU_PASSWORD',
    label: 'CHURU',
  },
  RAJGARH: {
    role: 'PS_RO',
    ps: 'RAJGARH PANCHAYAT SAMITI',
    passwordVar: 'DEMO_RO_RAJGARH_PASSWORD',
    label: 'RAJGARH',
  },
  ZP: { role: 'ZP_RO', ps: null, passwordVar: 'DEMO_ZP_RO_PASSWORD', label: 'ZP' },
} as const;
type ActorKey = keyof typeof ACTORS;

/** Set by Ctrl+C: finish the current request, then stop. */
const control = { stopping: false };
/** A function, so TypeScript never assumes the flag cannot change between checks. */
const isStopping = (): boolean => control.stopping;

/** Tiny HTTP client with one session cookie and the CSRF token, retrying politely on 429. */
class ApiClient {
  private cookie = '';
  private token = '';

  constructor(private readonly base: string) {}

  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          ...(this.cookie ? { Cookie: this.cookie } : {}),
          ...(method !== 'GET'
            ? { 'X-CSRF-Token': this.token, 'Content-Type': 'application/json' }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const c of res.headers.getSetCookie()) {
        if (c.startsWith('churu.sid=')) this.cookie = c.split(';')[0] ?? '';
      }
      const text = await res.text();
      const data: unknown = text === '' ? null : JSON.parse(text);
      if (res.status === 429 && attempt < 20) {
        await sleep(5000); // rate limited: wait and retry (never hammer the server)
        continue;
      }
      return { status: res.status, data };
    }
  }

  async refreshCsrf(): Promise<void> {
    const res = await this.request('GET', '/api/auth/csrf');
    this.token = (res.data as { csrfToken: string }).csrfToken;
  }

  async login(username: string, password: string): Promise<void> {
    await this.refreshCsrf();
    const res = await this.request('POST', '/api/auth/login', { username, password });
    if (res.status !== 200)
      throw new Error(`login as ${username} failed: ${res.status} ${JSON.stringify(res.data)}`);
    await this.refreshCsrf(); // the token changes on login
  }

  async logout(): Promise<void> {
    await this.request('POST', '/api/auth/logout');
  }
}

interface Ballot {
  candidateId: number;
  isNota: boolean;
}
interface Booth {
  boothId: number;
  registeredVotersTotal: number | null;
  entered: boolean;
}
interface WardTask {
  id: number;
  wardNo: number;
  ballot: Ballot[];
  booths: Booth[];
  tie: boolean;
  postalEntered: boolean;
}

const rand = (min: number, max: number) => min + (randomInt(1_000_000) / 1_000_000) * (max - min);

/** Plausible votes that always add up exactly: turnout 55-80 %, NOTA 1-2 %. Tie wards: top two equal. */
function boothVotes(
  ballot: readonly Ballot[],
  registered: number | null,
  tie: boolean,
): { votes: number[]; total: number } {
  const target = Math.floor((registered ?? 800) * rand(0.55, 0.8));
  const votes = ballot.map(() => 0);
  const give = (i: number, n: number) => {
    votes[i] = (votes[i] ?? 0) + n;
  };
  const notaIdx = ballot.findIndex((b) => b.isNota);
  const realIdx = ballot.map((b, i) => (b.isNota ? -1 : i)).filter((i) => i >= 0);
  let remaining = target;
  if (notaIdx >= 0) {
    const nota = Math.floor(target * rand(0.01, 0.02));
    give(notaIdx, nota);
    remaining -= nota;
  }
  const [first = 0, second = 0, ...others] = realIdx;
  if (tie && realIdx.length >= 2) {
    // Top two get exactly the same votes in every booth; the others share less.
    const each = Math.floor(remaining * (others.length === 0 ? 0.5 : 0.36));
    give(first, each);
    give(second, each);
    remaining -= 2 * each;
    others.forEach((i, k) => {
      const share =
        k === others.length - 1 ? remaining : Math.floor(remaining / (others.length - k));
      give(i, share);
      remaining -= share;
    });
  } else {
    const weights = realIdx.map(() => rand(0.2, 1) ** 1.5);
    const sum = weights.reduce((a, b) => a + b, 0);
    let given = 0;
    realIdx.forEach((i, k) => {
      const share = Math.floor((remaining * (weights[k] ?? 0)) / sum);
      give(i, share);
      given += share;
    });
    give(first, remaining - given); // rounding remainder
  }
  return { votes, total: votes.reduce((a, b) => a + b, 0) };
}

async function simulateActor(
  key: ActorKey,
  username: string,
  password: string,
  base: string,
  opts: { speed: Speed; declare: boolean; ties: boolean },
  log: (line: string) => void,
): Promise<{ booths: number; postal: number; declared: number }> {
  const actor = ACTORS[key];
  const api = new ApiClient(base);
  await api.login(username, password);
  const stats = { booths: 0, postal: 0, declared: 0 };
  try {
    const wardList = (await api.request('GET', '/api/counting/wards')).data as {
      wards: {
        id: number;
        wardNo: number;
        status: string;
        isUnopposed: boolean;
        ballotLocked: boolean;
        postalEntered: boolean;
      }[];
    };
    const tasks: WardTask[] = [];
    for (const [i, w] of wardList.wards.entries()) {
      if (
        w.isUnopposed ||
        !w.ballotLocked ||
        (w.status !== 'NOT_STARTED' && w.status !== 'COUNTING')
      )
        continue;
      const ballot = (
        (await api.request('GET', `/api/counting/wards/${w.id}/ballot`)).data as {
          candidates: Ballot[];
        }
      ).candidates;
      const booths = (
        (await api.request('GET', `/api/counting/wards/${w.id}/booths`)).data as { booths: Booth[] }
      ).booths;
      tasks.push({
        id: w.id,
        wardNo: w.wardNo,
        ballot,
        booths,
        tie: opts.ties && i % 7 === 3,
        postalEntered: w.postalEntered,
      });
    }
    log(`[${actor.label}] ${tasks.length} ward(s) to count as ${username}`);

    // Round by round (10 booths per ward per round), all wards interleaved like a real hall.
    for (let round = 1; !isStopping(); round++) {
      let did = false;
      for (const t of tasks) {
        const todo = t.booths.filter((b) => !b.entered);
        for (const b of todo.slice(0, 10)) {
          if (isStopping()) break;
          const { votes, total } = boothVotes(t.ballot, b.registeredVotersTotal, t.tie);
          const res = await api.request('POST', '/api/counting/entries', {
            wardId: t.id,
            boothId: b.boothId,
            ballotFor: actor.role === 'PS_RO' ? 'PS' : 'ZP',
            roundNo: round,
            sheetTotal: total,
            votes: t.ballot.map((c, i) => ({ candidateId: c.candidateId, votes: votes[i] ?? 0 })),
          });
          b.entered = true;
          did = true;
          if (res.status === 201) stats.booths++;
          else
            log(
              `[${actor.label}] ward ${t.wardNo}: booth ${b.boothId} refused: ${JSON.stringify(res.data)}`,
            );
          await sleep(DELAY_MS[opts.speed]);
        }
        // A ward whose booths are all in: postal, then (optionally) declare.
        if (!isStopping() && t.booths.every((b) => b.entered) && !t.postalEntered) {
          t.postalEntered = true;
          const postal = t.ballot.map((c, i) =>
            t.tie ? (i < 2 && !c.isNota ? 2 : 0) : c.isNota ? 0 : randomInt(0, 6),
          );
          const res = await api.request('POST', `/api/counting/wards/${t.id}/postal`, {
            sheetTotal: postal.reduce((a, b) => a + b, 0),
            rejectedCount: randomInt(0, 4),
            votes: t.ballot.map((c, i) => ({ candidateId: c.candidateId, votes: postal[i] ?? 0 })),
          });
          if (res.status === 201) stats.postal++;
          if (opts.declare && res.status === 201) {
            if (await declareWard(api, t, actor.label, password, log)) stats.declared++;
          }
          did = true;
        }
      }
      if (!did) break;
      log(
        `[${actor.label}] round ${round} done (${stats.booths} booths, ${stats.postal} postal, ${stats.declared} declared)`,
      );
    }
  } finally {
    await api.logout();
  }
  return stats;
}

async function declareWard(
  api: ApiClient,
  t: WardTask,
  label: string,
  password: string,
  log: (line: string) => void,
): Promise<boolean> {
  const preview = await api.request('POST', `/api/declare/wards/${t.id}/preview`, {});
  if (preview.status !== 200) {
    log(`[${label}] ward ${t.wardNo}: not declarable: ${JSON.stringify(preview.data)}`);
    return false;
  }
  const p = preview.data as {
    result: {
      totalValidVotes: number;
      notaHighest: boolean;
      leader: { candidateId: number } | null;
    };
    wouldStore: { needsLottery: boolean; tiedCandidateIds: number[] };
  };
  const tied = p.wouldStore.tiedCandidateIds;
  const lotteryWinner = p.wouldStore.needsLottery ? tied[randomInt(tied.length)] : undefined;
  const body = {
    password,
    confirmWinnerCandidateId: lotteryWinner ?? p.result.leader?.candidateId,
    confirmTotalValidVotes: p.result.totalValidVotes,
    ...(lotteryWinner === undefined
      ? {}
      : {
          lottery: {
            winnerCandidateId: lotteryWinner,
            conductedBy: 'DEMO RO',
            note: 'DEMO lottery (simulation only)',
          },
        }),
    ...(p.result.notaHighest ? { acknowledgeNotaHighest: true } : {}),
  };
  const res = await api.request('POST', `/api/declare/wards/${t.id}`, body);
  log(
    res.status === 201
      ? `[${label}] ward ${t.wardNo}: DECLARED${lotteryWinner === undefined ? '' : ' (tie resolved by lottery)'}`
      : `[${label}] ward ${t.wardNo}: declare refused: ${JSON.stringify(res.data)}`,
  );
  return res.status === 201;
}

export interface SimulateOptions {
  ps?: string | undefined;
  zp?: boolean | undefined;
  speed?: string | undefined;
  declare?: boolean | undefined;
  ties?: boolean | undefined;
  yes?: boolean | undefined;
}

export function actorsFor(options: SimulateOptions): ActorKey[] {
  const ps = options.ps ?? (options.zp === true ? undefined : 'all-demo');
  const keys: ActorKey[] = [];
  if (ps === 'CHURU' || ps === 'all-demo') keys.push('CHURU');
  if (ps === 'RAJGARH' || ps === 'all-demo') keys.push('RAJGARH');
  if (options.zp === true) keys.push('ZP');
  return keys;
}

async function main(): Promise<number> {
  const { values } = parseCli(
    process.argv.slice(2),
    {
      ps: { type: 'string' },
      zp: { type: 'boolean' },
      speed: { type: 'string' },
      declare: { type: 'boolean' },
      ties: { type: 'boolean' },
      yes: { type: 'boolean' },
    },
    'npm run demo:simulate -- [--ps CHURU|RAJGARH|all-demo] [--zp] [--speed slow|normal|fast] [--declare] [--ties] [--yes]',
  );
  if (values.ps !== undefined && !['CHURU', 'RAJGARH', 'all-demo'].includes(values.ps)) {
    console.error('--ps must be CHURU, RAJGARH or all-demo');
    return 2;
  }
  const speed = (values.speed ?? 'normal') as Speed;
  if (!(speed in DELAY_MS)) {
    console.error('--speed must be slow, normal or fast');
    return 2;
  }

  // Guard BEFORE any connection.
  dotenv.config({ quiet: true });
  const parsed = parseEnv(scriptEnvSchema, process.env);
  try {
    assertDemoEnvironment({
      nodeEnv: process.env.NODE_ENV,
      dbName: parsed.ok ? parsed.env.DB_NAME : undefined,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (!parsed.ok) {
    console.error(`Configuration error: ${parsed.problems.join('; ')}`);
    return 1;
  }
  const base = (process.env.DEMO_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const keys = actorsFor(values);
  const missing = keys
    .map((k) => ACTORS[k].passwordVar)
    .filter((v) => (process.env[v] ?? '') === '');
  if (missing.length > 0) {
    console.error(`Set the demo password(s) printed by demo:seed in: ${missing.join(', ')}`);
    return 1;
  }

  // Find the demo accounts (read only; only demo_ usernames).
  const pool = createPool({
    host: parsed.env.DB_HOST,
    port: parsed.env.DB_PORT,
    database: parsed.env.DB_NAME,
    user: parsed.env.DB_APP_USER,
    password: parsed.env.DB_APP_PASSWORD,
  });
  const usernames = new Map<ActorKey, string>();
  try {
    const [db] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS name');
    assertDemoEnvironment({ nodeEnv: process.env.NODE_ENV, dbName: String(db[0]?.name ?? '') });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT u.username, u.role, ps.name_english AS ps FROM users u
         LEFT JOIN panchayat_samiti ps ON ps.id = u.panchayat_samiti_id
        WHERE u.username LIKE 'demo\\_%' AND u.is_active = 1`,
    );
    for (const key of keys) {
      const a = ACTORS[key];
      const row = rows.find((r) => r.role === a.role && (a.ps === null || r.ps === a.ps));
      if (!row)
        throw new Error(`No demo account for ${a.label}. Run npm run demo:seed -- --commit first.`);
      usernames.set(key, String(row.username));
    }
  } finally {
    await pool.end();
  }

  console.log(
    `DEMO SIMULATION on ${parsed.env.DB_NAME} via ${base}: ${keys.join(', ')}, speed ${speed}` +
      `${values.declare === true ? ', declaring' : ''}${values.ties === true ? ', with ties' : ''}.`,
  );
  if (values.yes !== true) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('This enters FAKE DEMO results. Type SIMULATE to start: ');
    rl.close();
    if (answer.trim() !== 'SIMULATE') {
      console.log('Not confirmed. Nothing was entered.');
      return 1;
    }
  }

  process.on('SIGINT', () => {
    if (control.stopping) process.exit(130);
    control.stopping = true;
    console.log('\nStopping after the current request (Ctrl+C again to quit at once)...');
  });

  const log = (line: string) => {
    console.log(`${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} ${line}`);
  };
  const results = await Promise.all(
    keys.map((key) =>
      simulateActor(
        key,
        usernames.get(key) ?? '',
        process.env[ACTORS[key].passwordVar] ?? '',
        base,
        {
          speed,
          declare: values.declare === true,
          ties: values.ties === true,
        },
        log,
      ),
    ),
  );
  const totals = results.reduce(
    (a, r) => ({
      booths: a.booths + r.booths,
      postal: a.postal + r.postal,
      declared: a.declared + r.declared,
    }),
    {
      booths: 0,
      postal: 0,
      declared: 0,
    },
  );
  console.log(
    `${control.stopping ? 'STOPPED' : 'DONE'}: ${totals.booths} booth entries, ${totals.postal} postal, ${totals.declared} declared.`,
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error('Simulation failed:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}
