// A hand-built district for the DM reports tests: every report case on its own ward, built through
// the real counting/declare API (states the API cannot make are forced with the migration user).
import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import { createUser, seedTwoPs } from '../auth/helpers.js';
import { PASSWORD, countingApp } from '../counting/helpers.js';
import { declareClient } from '../declare/helpers.js';
import type { DeclareClient } from '../declare/helpers.js';
import { insert } from '../helpers/db.js';

type Gender = 'M' | 'F';
type Sheet = [number, number, number]; // A, B, NOTA

export interface RWard {
  id: number;
  boothId: number;
  A: number;
  B: number;
  NOTA: number;
  entryId: number | null;
}

export interface ReportWorld {
  app: Express;
  ps1: number;
  ps2: number;
  parties: { P1: number; P2: number };
  w: Record<string, RWard>;
  users: { ro1: string; ro2: string; zp: string; dm: string };
}

export const HYPERLINK = '=HYPERLINK("http://evil.example")';

export async function buildReportWorld(pool: Pool, migrator: Pool): Promise<ReportWorld> {
  const { ps1, ps2 } = await seedTwoPs(pool);
  const party = (hi: string, en: string, short: string) =>
    insert(
      pool,
      'INSERT INTO party (name_hindi, name_english, short_name, symbol) VALUES (?, ?, ?, ?)',
      [hi, en, short, 'चिह्न'],
    );
  const parties = {
    P1: await party('पहला दल', 'Party One', 'P1'),
    P2: await party('दूसरा दल', 'Party Two', 'P2'),
  };
  const ward = (type: 'PS' | 'ZP', ps: number | null, no: number) =>
    insert(
      pool,
      'INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT ?, district_id, ?, ? FROM panchayat_samiti WHERE id = ?',
      [type, ps, no, ps1],
    );
  const zpRest = await ward('ZP', null, 2); // the ZP ward of most booths: no candidates
  const zp1 = await ward('ZP', null, 1);
  let boothNo = 0;
  const booth = (ps: number, psWard: number, zpWard: number) =>
    insert(
      pool,
      'INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id) VALUES (?, ?, ?, ?, ?)',
      [ps, ++boothNo, `बूथ ${boothNo}`, psWard, zpWard],
    );
  const cand = (
    w: number,
    pos: number,
    name: string,
    gender: Gender | null,
    partyId: number | null,
    nota = false,
  ) =>
    insert(
      pool,
      'INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota, party_id) VALUES (?, ?, ?, ?, ?, ?)',
      [w, pos, name, nota ? null : gender, nota ? 1 : 0, nota ? null : partyId],
    );
  const lock = (w: number) =>
    pool.execute(
      "UPDATE ward SET is_locked = 1, locked_at = NOW(3), locked_by_name = 'Test' WHERE id = ?",
      [w],
    );

  const w: Record<string, RWard> = {};
  const make = async (
    key: string,
    ps: number,
    no: number,
    a: [string, Gender, number | null],
    b: [string, Gender, number | null] | null,
    zpWard = zpRest,
  ) => {
    const id = await ward('PS', ps, no);
    const boothId = await booth(ps, id, zpWard);
    const A = await cand(id, 1, a[0], a[1], a[2]);
    const B = b === null ? 0 : await cand(id, 2, b[0], b[1], b[2]);
    const NOTA = b === null ? 0 : await cand(id, 3, 'नोटा', null, null, true);
    if (b === null) await pool.execute('UPDATE ward SET is_unopposed = 1 WHERE id = ?', [id]);
    await lock(id);
    w[key] = { id, boothId, A, B, NOTA, entryId: null };
  };
  const { P1, P2 } = parties;
  await make('close100', ps1, 1, ['सीमा देवी', 'F', P1], [HYPERLINK, 'M', P2]); // female winner, margin 100
  await make('close1pct', ps1, 2, ['मोहन', 'M', P1], ['सोहन', 'M', P2]); // margin 101 of 10,100 = 1%: in
  await make('notClose', ps1, 3, ['राम', 'M', P1], ['श्याम', 'M', P2]); // margin 101 of 10,000: out
  await make('lottery', ps1, 4, ['गोविंद', 'M', P1], ['कमला', 'F', null]); // tie -> lottery: कमला (F, independent)
  await make('unopposed', ps1, 5, ['गीता', 'F', P2], null); // unopposed female winner
  await make('corrected', ps1, 6, ['अमित', 'M', P1], ['विनोद', 'M', P2]); // v2 changes the winner
  await make('notaHigh', ps1, 7, ['रमेश', 'M', P1], ['सुरेश', 'M', P2]); // NOTA highest, declared
  await make('mismatch', ps1, 8, ['दिनेश', 'M', P1], ['महेश', 'M', P2]); // declared, then a vote changes
  await make('broken', ps1, 9, ['अजय', 'M', P1], ['विजय', 'M', P2]); // entry broken -> UNAVAILABLE
  await make('zpBooth', ps1, 10, ['अनिल', 'M', P1], ['सुनील', 'M', P2], zp1); // not started; its booth is ZP ward 1
  await make('ps2Lead', ps2, 1, ['रेखा', 'F', P1], ['मनोज', 'M', P2]); // counting: a woman LEADS (not a winner)
  // ZP ward 1: one booth (zpBooth's), a female winner.
  const zA = await cand(zp1, 1, 'सरला', 'F', P2);
  const zB = await cand(zp1, 2, 'प्रकाश', 'M', P1);
  const zN = await cand(zp1, 3, 'नोटा', null, null, true);
  await lock(zp1);
  w.zp1 = { id: zp1, boothId: w.zpBooth?.boothId ?? 0, A: zA, B: zB, NOTA: zN, entryId: null };
  // Reservation categories on two PS wards only.
  await pool.execute("UPDATE ward SET reservation_category = 'महिला' WHERE id = ?", [
    w.close100?.id ?? 0,
  ]);
  await pool.execute("UPDATE ward SET reservation_category = 'सामान्य' WHERE id IN (?, ?)", [
    w.close1pct?.id ?? 0,
    w.notClose?.id ?? 0,
  ]);
  // Turnout data: only close100's booth has a registered-voter count.
  await pool.execute('UPDATE booth SET registered_voters_total = 2000 WHERE id = ?', [
    w.close100?.boothId ?? 0,
  ]);

  const users = { ro1: 'rep_ro1', ro2: 'rep_ro2', zp: 'rep_zp', dm: 'rep_dm' };
  await createUser(pool, { username: users.ro1, role: 'PS_RO', psId: ps1, password: PASSWORD });
  await createUser(pool, { username: users.ro2, role: 'PS_RO', psId: ps2, password: PASSWORD });
  await createUser(pool, { username: users.zp, role: 'ZP_RO', password: PASSWORD });
  await createUser(pool, { username: users.dm, role: 'DM', password: PASSWORD });

  const app = countingApp(pool);
  const ro1 = await declareClient(app, users.ro1);
  const ro2 = await declareClient(app, users.ro2);
  const zp = await declareClient(app, users.zp);
  const rows = (x: RWard, [a, b, n]: Sheet) => [
    { candidateId: x.A, votes: a },
    { candidateId: x.B, votes: b },
    { candidateId: x.NOTA, votes: n },
  ];
  const ok = (res: { status: number; body: unknown }, what: string) => {
    if (res.status !== 200 && res.status !== 201)
      throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as Record<string, unknown>;
  };
  const fill = async (
    c: DeclareClient,
    key: string,
    sheet: Sheet,
    ballotFor: 'PS' | 'ZP' = 'PS',
    postal: Sheet = [0, 0, 0],
  ) => {
    const x = w[key];
    if (!x) throw new Error(key);
    const e = ok(
      await c.post('/entries', {
        wardId: x.id,
        boothId: x.boothId,
        ballotFor,
        roundNo: 1,
        sheetTotal: sheet[0] + sheet[1] + sheet[2],
        votes: rows(x, sheet),
      }),
      `${key} entry`,
    );
    x.entryId = (e.entry as { id: number }).id;
    ok(
      await c.post(`/wards/${x.id}/postal`, {
        sheetTotal: postal[0] + postal[1] + postal[2],
        votes: rows(x, postal),
      }),
      `${key} postal`,
    );
  };
  const declare = async (c: DeclareClient, key: string, extra: Record<string, unknown> = {}) => {
    const x = w[key];
    if (!x) throw new Error(key);
    const p = ok(await c.dpost(`/wards/${x.id}/preview`, {}), `${key} preview`) as {
      result: { leader: { candidateId: number }; totalValidVotes: number };
    };
    ok(
      await c.dpost(`/wards/${x.id}`, {
        password: PASSWORD,
        confirmWinnerCandidateId: p.result.leader.candidateId,
        confirmTotalValidVotes: p.result.totalValidVotes,
        ...extra,
      }),
      `${key} declare`,
    );
  };

  // close100: an edit before declaring (history: 1 edit), then declare (margin 100, valid 910).
  await fill(ro1, 'close100', [500, 400, 10]);
  const c100 = w.close100;
  if (!c100) throw new Error('close100');
  ok(
    await ro1.put(`/entries/${c100.entryId ?? 0}`, {
      rowVersion: 1,
      roundNo: 2,
      sheetTotal: 910,
      votes: rows(c100, [500, 400, 10]),
      reason: 'राउंड संख्या गलत',
    }),
    'close100 edit',
  );
  await declare(ro1, 'close100');
  await fill(ro1, 'close1pct', [5100, 4999, 1]);
  await declare(ro1, 'close1pct');
  // notClose: entered, voided, entered again (history: 1 void), then declared.
  await fill(ro1, 'notClose', [5050, 4949, 1]);
  const nc = w.notClose;
  if (!nc) throw new Error('notClose');
  ok(
    await ro1.post(`/entries/${nc.entryId ?? 0}/void`, {
      rowVersion: 1,
      reason: 'गलत बूथ चुना गया',
    }),
    'void',
  );
  const again = ok(
    await ro1.post('/entries', {
      wardId: nc.id,
      boothId: nc.boothId,
      ballotFor: 'PS',
      roundNo: 1,
      sheetTotal: 10000,
      votes: rows(nc, [5050, 4949, 1]),
    }),
    're-enter',
  );
  nc.entryId = (again.entry as { id: number }).id;
  await declare(ro1, 'notClose');
  // lottery: tie, the lottery picks कमला.
  await fill(ro1, 'lottery', [150, 150, 3]);
  const lot = w.lottery;
  if (!lot) throw new Error('lottery');
  const lp = ok(await ro1.dpost(`/wards/${lot.id}/preview`, {}), 'lottery preview') as {
    result: { totalValidVotes: number };
  };
  ok(
    await ro1.dpost(`/wards/${lot.id}`, {
      password: PASSWORD,
      confirmWinnerCandidateId: lot.B,
      confirmTotalValidVotes: lp.result.totalValidVotes,
      lottery: {
        winnerCandidateId: lot.B,
        conductedBy: 'रिटर्निंग अधिकारी',
        note: 'दोनों के सामने पर्ची निकाली गई',
      },
    }),
    'lottery declare',
  );
  // corrected: v1 अमित wins, v2 (correction) विनोद wins.
  await fill(ro1, 'corrected', [400, 200, 5]); // margin 200: not a close contest
  await declare(ro1, 'corrected');
  const co = w.corrected;
  if (!co) throw new Error('corrected');
  const changes = [
    {
      kind: 'BOOTH',
      entryId: co.entryId,
      rowVersion: 1,
      sheetTotal: 605,
      votes: rows(co, [200, 400, 5]),
    },
  ];
  const cp = ok(
    await ro1.dpost(`/wards/${co.id}/correction/preview`, { changes }),
    'correction preview',
  ) as {
    after: { leader: { candidateId: number }; totalValidVotes: number };
  };
  ok(
    await ro1.dpost(`/wards/${co.id}/correction`, {
      password: PASSWORD,
      reason: 'पुनर्गणना में मत बदले',
      changes,
      confirmWinnerCandidateId: cp.after.leader.candidateId,
      confirmTotalValidVotes: cp.after.totalValidVotes,
    }),
    'correction',
  );
  // notaHigh: NOTA has the most votes; declared with the acknowledgement.
  await fill(ro1, 'notaHigh', [100, 250, 400]); // margin 150 of 750: not close
  await declare(ro1, 'notaHigh', { acknowledgeNotaHighest: true });
  // mismatch: declared, then a vote and its sheet total are changed behind the app's back.
  await fill(ro1, 'mismatch', [400, 200, 5]); // margin 200
  await declare(ro1, 'mismatch');
  const mm = w.mismatch;
  if (!mm) throw new Error('mismatch');
  await migrator.execute(
    'UPDATE booth_entry_vote SET votes = votes + 10 WHERE entry_id = ? AND candidate_id = ?',
    [mm.entryId, mm.A],
  );
  await migrator.execute('UPDATE booth_entry SET sheet_total = sheet_total + 10 WHERE id = ?', [
    mm.entryId,
  ]);
  // broken: a vote changed without its sheet total: the engine refuses the ward (UNAVAILABLE).
  await fill(ro1, 'broken', [10, 5, 1]);
  const br = w.broken;
  if (!br) throw new Error('broken');
  await migrator.execute(
    'UPDATE booth_entry_vote SET votes = votes + 1 WHERE entry_id = ? AND candidate_id = ?',
    [br.entryId, br.A],
  );
  // ps2Lead: counting, the woman leads (booth only, no postal).
  const pl = w.ps2Lead;
  if (!pl) throw new Error('ps2Lead');
  ok(
    await ro2.post('/entries', {
      wardId: pl.id,
      boothId: pl.boothId,
      ballotFor: 'PS',
      roundNo: 1,
      sheetTotal: 90,
      votes: rows(pl, [50, 40, 0]),
    }),
    'ps2Lead',
  );
  // ZP ward 1: entered and declared, a woman wins.
  await fill(zp, 'zp1', [700, 300, 20], 'ZP');
  await declare(zp, 'zp1');

  return { app, ps1, ps2, parties, w, users };
}
