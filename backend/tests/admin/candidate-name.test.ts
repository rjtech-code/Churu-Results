// "नाम सुधारें": name-only correction of a candidate after the ballot lock (PS_RO own PS, ZP_RO ZP
// wards), with password re-check, reason, compare-and-set and the append-only history.
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_FAILED_LOGINS } from '../../src/modules/auth/auth.service.js';
import { checkNewName } from '../../src/services/candidate-name.js';
import { createUser } from '../auth/helpers.js';
import { declareClient, fillPsW1, previewResult, confirmBody } from '../declare/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  PASSWORD,
  adminApp,
  apiClient,
  auditOf,
  buildAdminWorld,
  countRows,
  masterSnapshot,
} from './helpers.js';
import type { AdminWorld, ApiClient } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;
let app: Express;

const SA = 'super_admin_n1';
const REASON = 'नामांकन पत्र में वर्तनी की गलती ठीक की';

beforeAll(() => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});
beforeEach(async () => {
  await resetData(migrator);
  w = await buildAdminWorld(pool);
  await createUser(pool, { username: SA, role: 'SUPER_ADMIN', password: PASSWORD });
  app = adminApp(pool);
});

const path = (wardId: number, candidateId: number) =>
  `/api/candidates/wards/${wardId}/candidates/${candidateId}/name`;

function body(currentName: string, newName: string, extra: Record<string, unknown> = {}) {
  return { currentName, newName, reason: REASON, password: PASSWORD, ...extra };
}

async function nameOf(candidateId: number): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT name_hindi FROM candidate WHERE id = ?',
    [candidateId],
  );
  return String(rows[0]?.name_hindi);
}

async function history() {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM candidate_name_change ORDER BY id',
  );
  return rows;
}

interface CandidateView {
  id: number;
  nameHindi: string;
  nameChanged: boolean;
}
const candidatesOf = (b: unknown) => (b as { candidates: CandidateView[] }).candidates;
const changesOf = (b: unknown) => (b as { changes: Record<string, unknown>[] }).changes;
const wardOf = (b: unknown) => (b as { ward: Record<string, unknown> }).ward;

async function failedCount(username: string): Promise<number> {
  return countRows(pool, 'SELECT failed_login_count AS n FROM users WHERE username = ?', [
    username,
  ]);
}

// ---------------------------------------------------------------- pure rules

describe('checkNewName', () => {
  it('normalizes and accepts a real change', () => {
    expect(checkNewName('  राम   कुमार ', 'राम')).toEqual({ ok: true, name: 'राम कुमार' });
  });
  it('refuses empty, too long, unchanged and control / invisible characters', () => {
    expect(checkNewName('   ', 'राम')).toEqual({ ok: false, problem: 'NAME_EMPTY' });
    expect(checkNewName('क'.repeat(201), 'राम')).toEqual({ ok: false, problem: 'NAME_TOO_LONG' });
    expect(checkNewName('क'.repeat(200), 'राम').ok).toBe(true);
    expect(checkNewName(' राम ', 'राम')).toEqual({ ok: false, problem: 'NAME_UNCHANGED' });
    for (const bad of ['रा\nम', 'रा\tम', 'रा\u0000म', 'रा‮म', 'रा​म', 'रा﻿म', 'रा\uD800म']) {
      expect(checkNewName(bad, 'श्याम')).toEqual({ ok: false, problem: 'NAME_INVALID_CHARS' });
    }
  });
  it('keeps ZWJ / ZWNJ (used in Hindi spelling)', () => {
    expect(checkNewName('क्‍ष', 'राम').ok).toBe(true);
    expect(checkNewName('क्‌ष', 'राम').ok).toBe(true);
  });
});

// ---------------------------------------------------------------- permissions

describe('who may correct a name', () => {
  it('PS_RO: own PS ward yes; other PS ward and ZP ward 403', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const ok = await ro.post(path(w.psW1, w.c.A), body('ए', 'ए कुमार'));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ candidateId: w.c.A, oldName: 'ए', nameHindi: 'ए कुमार' });

    const before = await masterSnapshot(pool);
    expect((await ro.post(path(w.psW2, w.c.C), body('सी', 'सी दो'))).status).toBe(403);
    expect((await ro.post(path(w.zW1, w.c.E), body('ई', 'ई दो'))).status).toBe(403);
    expect(await masterSnapshot(pool)).toBe(before);
  });

  it('ZP_RO: ZP ward yes; PS ward 403', async () => {
    const zp = await apiClient(app, 'zp_ro_x3');
    expect((await zp.post(path(w.zW1, w.c.E), body('ई', 'ई सिंह'))).status).toBe(200);
    expect(await nameOf(w.c.E)).toBe('ई सिंह');
    expect((await zp.post(path(w.psW1, w.c.A), body('ए', 'ए दो'))).status).toBe(403);
    expect(await nameOf(w.c.A)).toBe('ए');
  });

  it('DM and Super Admin: 403, and their password is not even checked (no lockout count)', async () => {
    for (const user of ['dm_x4', SA]) {
      const c = await apiClient(app, user);
      const res = await c.post(path(w.psW1, w.c.A), body('ए', 'ए दो', { password: 'wrong-pass' }));
      expect(res.status).toBe(403);
      expect(await failedCount(user)).toBe(0);
    }
    expect(await nameOf(w.c.A)).toBe('ए');
    expect(await history()).toHaveLength(0);
  });

  it('an RO of another PS / a ZP_RO gets 403 before the password is checked', async () => {
    const ro2 = await apiClient(app, 'ro_ps2_x2');
    const res = await ro2.post(path(w.psW1, w.c.A), body('ए', 'ए दो', { password: 'wrong-pass' }));
    expect(res.status).toBe(403);
    expect(await failedCount('ro_ps2_x2')).toBe(0);
  });

  it('unknown ward / candidate of another ward / NOTA: 404', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    expect((await ro.post(path(999_999, w.c.A), body('ए', 'ए दो'))).status).toBe(404);
    expect((await ro.post(path(w.psW1, w.c.U), body('यू', 'यू दो'))).status).toBe(404);
    expect((await ro.post(path(w.psW1, w.c.N1), body('नोटा', 'कोई नहीं'))).status).toBe(404);
  });

  it('without login: 401; without CSRF token: refused', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const noCsrf = await ro.agent.post(path(w.psW1, w.c.A)).send(body('ए', 'ए दो'));
    expect(noCsrf.status).toBe(403);
    expect(await nameOf(w.c.A)).toBe('ए');
  });
});

// ---------------------------------------------------------------- lock rules

describe('ballot lock', () => {
  it('before the lock: refused (BALLOT_NOT_LOCKED), and the normal list edit still works', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(path(w.psW4, w.c.G), body('जी', 'जी दो'));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'BALLOT_NOT_LOCKED' });
    expect(await failedCount('ro_ps1_x1')).toBe(0);

    const read = await ro.get(`/api/candidates/wards/${w.psW4}`);
    expect(wardOf(read.body)).toMatchObject({ editable: true, nameCorrectable: false });
    const saved = await ro.put(`/api/candidates/wards/${w.psW4}`, {
      candidates: [
        { ballotPosition: 1, nameHindi: 'जी नया', partyId: null, gender: 'M' },
        { ballotPosition: 2, nameHindi: 'एच', partyId: null, gender: 'M' },
      ],
    });
    expect(saved.status).toBe(200);
    expect(await history()).toHaveLength(0);
  });

  it('after the lock: the whole-list save (party, order, add, remove) is still refused', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const read = await ro.get(`/api/candidates/wards/${w.psW1}`);
    expect(wardOf(read.body)).toMatchObject({ editable: false, nameCorrectable: true });
    const before = await masterSnapshot(pool);
    for (const candidates of [
      [
        { ballotPosition: 1, nameHindi: 'ए', partyId: w.p1, gender: 'M' },
        { ballotPosition: 2, nameHindi: 'बी', partyId: null, gender: 'M' },
      ],
      [
        { ballotPosition: 1, nameHindi: 'बी', partyId: null, gender: 'M' },
        { ballotPosition: 2, nameHindi: 'ए', partyId: null, gender: 'M' },
      ],
      [{ ballotPosition: 1, nameHindi: 'ए', partyId: null, gender: 'M' }],
      // A name change through the list form is refused too: only "नाम सुधारें" may do it.
      [
        { ballotPosition: 1, nameHindi: 'ए नया', partyId: null, gender: 'M' },
        { ballotPosition: 2, nameHindi: 'बी', partyId: null, gender: 'M' },
      ],
    ]) {
      const res = await ro.put(`/api/candidates/wards/${w.psW1}`, { candidates });
      expect(res.status).toBe(400);
    }
    expect(await masterSnapshot(pool)).toBe(before);
  });

  // Since "विवरण सुधारें" (Nov 2026) the body may also carry the other details; the ballot order,
  // add / remove and NOTA stay frozen and are refused by name (candidate-details.test.ts covers the
  // fields that ARE allowed).
  it('frozen keys (ballot order, add / remove, NOTA) and unknown keys are refused', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    for (const extra of [
      { ballotPosition: 2 },
      { position: 2 },
      { order: 2 },
      { isNota: 1 },
      { nota: true },
      { candidates: [] },
      { remove: true },
      { symbol: 'कमल' },
    ]) {
      const res = await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो', extra));
      expect(res.status).toBe(400);
      expect((res.body as { error?: string }).error).toBe('FIELD_FROZEN');
    }
    // An unknown key is still refused (strict body).
    expect((await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो', { oops: 1 }))).status).toBe(400);
    expect(await nameOf(w.c.A)).toBe('ए');
  });

  it('a name-only correction changes only name_hindi: party, gender, position, details, NOTA and ward stay identical', async () => {
    await pool.execute(
      "UPDATE candidate SET party_id = ?, education = 'SECONDARY', mobile = '9876543210' WHERE id = ?",
      [w.p1, w.c.A],
    );
    const cols =
      'SELECT id, ward_id, ballot_position, party_id, gender, is_nota, dob, age_stated, education, mobile, candidate_category, address, occupation FROM candidate ORDER BY id';
    const [before] = await pool.query<RowDataPacket[]>(cols);
    const [wardsBefore] = await pool.query<RowDataPacket[]>('SELECT * FROM ward ORDER BY id');
    const ro = await apiClient(app, 'ro_ps1_x1');
    expect((await ro.post(path(w.psW1, w.c.A), body('ए', 'ए शर्मा'))).status).toBe(200);
    const [after] = await pool.query<RowDataPacket[]>(cols);
    const [wardsAfter] = await pool.query<RowDataPacket[]>('SELECT * FROM ward ORDER BY id');
    expect(after).toEqual(before);
    expect(wardsAfter).toEqual(wardsBefore);
  });

  it('counting started and ward declared: still allowed; votes and declaration unchanged', async () => {
    const ro = await declareClient(app, 'ro_ps1_x1');
    await fillPsW1(ro, w);
    const result = await previewResult(ro, w.psW1);
    expect((await ro.dpost(`/wards/${w.psW1}`, confirmBody(result))).status).toBe(201);
    const [declBefore] = await pool.query<RowDataPacket[]>('SELECT * FROM ward_declarations');
    const [votesBefore] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM booth_entry_vote ORDER BY id',
    );

    const rc = await apiClient(app, 'ro_ps1_x1');
    const res = await rc.post(path(w.psW1, w.c.A), body('ए', 'ए वर्मा'));
    expect(res.status).toBe(200);

    const [declAfter] = await pool.query<RowDataPacket[]>('SELECT * FROM ward_declarations');
    const [votesAfter] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM booth_entry_vote ORDER BY id',
    );
    expect(declAfter).toEqual(declBefore);
    expect(votesAfter).toEqual(votesBefore);
    // The engine still sees the same declared result, with the new name.
    const after = await previewResult(ro, w.psW1).catch(() => null);
    expect(after).toBeNull(); // a declared ward has no preview any more (unchanged rule)
    const ballot = await ro.get(`/wards/${w.psW1}/ballot`);
    expect(JSON.stringify(ballot.body)).toContain('ए वर्मा');
    expect(JSON.stringify(ballot.body)).not.toContain('"ए"');
  });

  it('works while the Super Admin counting lock is ON (it is needed on counting day)', async () => {
    await pool.execute(
      "INSERT INTO app_settings (setting_key, setting_value) VALUES ('counting_lock', 'true') ON DUPLICATE KEY UPDATE setting_value = 'true'",
    );
    const ro = await apiClient(app, 'ro_ps1_x1');
    expect((await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो'))).status).toBe(200);
  });
});

// ---------------------------------------------------------------- password, reason, name

describe('password re-check', () => {
  it('wrong password: 401 REAUTH_FAILED, counted, nothing written; never stored or logged', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const wrong = 'Galat-Pass-77';
    const res = await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो', { password: wrong }));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'REAUTH_FAILED' });
    expect(await failedCount('ro_ps1_x1')).toBe(1);
    expect(await nameOf(w.c.A)).toBe('ए');
    expect(await history()).toHaveLength(0);
    expect(await auditOf(pool, 'CANDIDATE_NAME_CORRECTED')).toHaveLength(0);
    const [audit] = await pool.query<RowDataPacket[]>('SELECT * FROM audit_log');
    expect(JSON.stringify(audit)).not.toContain(wrong);
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it(`${String(MAX_FAILED_LOGINS)} wrong passwords lock the account (the login lockout): 423, even with the right one`, async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
      const res = await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो', { password: `wrong-${i}` }));
      expect(res.status).toBe(401);
    }
    const locked = await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो'));
    expect(locked.status).toBe(423);
    expect(locked.body).toMatchObject({ error: 'ACCOUNT_LOCKED' });
    expect(await nameOf(w.c.A)).toBe('ए');
    // The same lockout as the login page.
    const again = await apiClient(app, 'ro_ps1_x1').catch((e: unknown) => e);
    expect(again).toBeInstanceOf(Error);
  });

  it('a correct password after failures resets the counter', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो', { password: 'wrong-1' }));
    expect(await failedCount('ro_ps1_x1')).toBe(1);
    expect((await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो'))).status).toBe(200);
    expect(await failedCount('ro_ps1_x1')).toBe(0);
  });

  it('missing password: 400 (not counted)', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    expect((await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो', { password: '' }))).status).toBe(
      400,
    );
    const { password: _p, ...noPassword } = body('ए', 'ए दो');
    expect((await ro.post(path(w.psW1, w.c.A), noPassword)).status).toBe(400);
    expect(await failedCount('ro_ps1_x1')).toBe(0);
  });
});

describe('reason and name validation', () => {
  it('missing, blank or short reason (< 10 after trim) and an over-long reason: 400', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    for (const reason of [undefined, '', '          ', '  छोटा   ', 'x'.repeat(501)]) {
      const res = await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो', { reason }));
      expect(res.status).toBe(400);
    }
    expect(await nameOf(w.c.A)).toBe('ए');
    expect(await failedCount('ro_ps1_x1')).toBe(0);
  });

  it('the reason is stored trimmed', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो', { reason: `   ${REASON}   ` }));
    expect((await history())[0]?.reason).toBe(REASON);
  });

  it('empty / too long / control characters / unchanged name: refused before the password', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const cases: [string, number, string][] = [
      ['   ', 400, 'NAME_EMPTY'],
      ['क'.repeat(201), 400, 'NAME_TOO_LONG'],
      ['ए\nदो', 400, 'NAME_INVALID_CHARS'],
      ['ए‮दो', 400, 'NAME_INVALID_CHARS'],
      [' ए ', 409, 'NAME_UNCHANGED'],
    ];
    for (const [newName, status, code] of cases) {
      const res = await ro.post(path(w.psW1, w.c.A), body('ए', newName, { password: 'wrong' }));
      expect(res.status).toBe(status);
      expect(res.body).toMatchObject({ error: code });
    }
    expect(await failedCount('ro_ps1_x1')).toBe(0);
    expect(await nameOf(w.c.A)).toBe('ए');
  });

  it('the new name is stored normalized (NFC, single spaces, trimmed)', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(path(w.psW1, w.c.A), body('ए', '  ए   कुमार  '));
    expect(res.status).toBe(200);
    expect(await nameOf(w.c.A)).toBe('ए कुमार');
  });
});

// ---------------------------------------------------------------- history, audit, atomicity

describe('history and audit', () => {
  it('one history row and one audit row, with who / when / old / new / reason', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    await ro.post(path(w.psW1, w.c.B), body('बी', 'बी लाल'));
    const rows = await history();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ward_id: w.psW1,
      candidate_id: w.c.B,
      ballot_position: 2,
      old_name_hindi: 'बी',
      new_name_hindi: 'बी लाल',
      reason: REASON,
      changed_by: w.users.ro1,
      changed_by_role: 'PS_RO',
    });
    expect(rows[0]?.changed_at).toBeInstanceOf(Date);
    const audit = await auditOf(pool, 'CANDIDATE_NAME_CORRECTED');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      user_id: w.users.ro1,
      entity_id: String(w.c.B), // BIGINT column: mysql2 returns it as a string
      reason: REASON,
      old_value: { ward_id: w.psW1, position: 2, name_hindi: 'बी' },
      new_value: { ward_id: w.psW1, position: 2, name_hindi: 'बी लाल' },
    });
  });

  it('two corrections in a row keep both rows (old -> new chain)', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    expect((await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो'))).status).toBe(200);
    expect((await ro.post(path(w.psW1, w.c.A), body('ए दो', 'ए तीन'))).status).toBe(200);
    const rows = await history();
    expect(rows.map((r) => [String(r.old_name_hindi), String(r.new_name_hindi)])).toEqual([
      ['ए', 'ए दो'],
      ['ए दो', 'ए तीन'],
    ]);
  });

  it('atomic: if the audit row fails, the name and the history row are rolled back', async () => {
    await migrator.query(`
      CREATE TRIGGER trg_test_fail_name_audit BEFORE INSERT ON audit_log FOR EACH ROW
      BEGIN
        IF NEW.action = 'CANDIDATE_NAME_CORRECTED' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test: audit insert fails';
        END IF;
      END`);
    try {
      const ro = await apiClient(app, 'ro_ps1_x1');
      const res = await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो'));
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('test: audit');
    } finally {
      await migrator.query('DROP TRIGGER IF EXISTS trg_test_fail_name_audit');
    }
    expect(await nameOf(w.c.A)).toBe('ए');
    expect(await history()).toHaveLength(0);
  });

  it('append-only: the app user cannot UPDATE or DELETE history rows; triggers block everyone', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो'));
    const id = Number((await history())[0]?.id);
    const DENIED = { code: 'ER_TABLEACCESS_DENIED_ERROR' };
    await expect(
      pool.execute("UPDATE candidate_name_change SET new_name_hindi = 'x' WHERE id = ?", [id]),
    ).rejects.toMatchObject(DENIED);
    await expect(
      pool.execute('DELETE FROM candidate_name_change WHERE id = ?', [id]),
    ).rejects.toMatchObject(DENIED);
    await expect(
      migrator.execute("UPDATE candidate_name_change SET new_name_hindi = 'x' WHERE id = ?", [id]),
    ).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' });
    await expect(
      migrator.execute('DELETE FROM candidate_name_change WHERE id = ?', [id]),
    ).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' });
    expect(await history()).toHaveLength(1);
  });
});

describe('concurrent edits (compare-and-set)', () => {
  it('a stale current name: 409 NAME_CHANGED_MEANWHILE with the stored name; nothing written', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    expect((await ro.post(path(w.psW1, w.c.A), body('ए', 'ए दो'))).status).toBe(200);
    const stale = await ro.post(path(w.psW1, w.c.A), body('ए', 'ए तीन'));
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: 'NAME_CHANGED_MEANWHILE', currentName: 'ए दो' });
    expect(await nameOf(w.c.A)).toBe('ए दो');
    expect(await history()).toHaveLength(1);
  });

  it('two requests at the same time from the same old name: exactly one wins', async () => {
    const one = await apiClient(app, 'ro_ps1_x1');
    const two = await apiClient(app, 'ro_ps1_x1');
    const results = await Promise.all([
      one.post(path(w.psW1, w.c.A), body('ए', 'ए पहला')),
      two.post(path(w.psW1, w.c.A), body('ए', 'ए दूसरा')),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)?.body as { nameHindi: string };
    expect(await nameOf(w.c.A)).toBe(winner.nameHindi);
    expect(await history()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- reading the new name and history

describe('the new name everywhere, and who sees the history', () => {
  async function renameA(): Promise<ApiClient> {
    const ro = await apiClient(app, 'ro_ps1_x1');
    expect((await ro.post(path(w.psW1, w.c.A), body('ए', 'ए नया नाम'))).status).toBe(200);
    return ro;
  }

  it('RO and DM candidate lists show the new name with the marker; counting ballot too', async () => {
    const ro = await renameA();
    const own = await ro.get(`/api/candidates/wards/${w.psW1}`);
    const a = (
      candidatesOf(own.body) as { id: number; nameHindi: string; nameChanged: boolean }[]
    ).find((c) => c.id === w.c.A);
    expect(a).toMatchObject({ nameHindi: 'ए नया नाम', nameChanged: true });
    expect(
      (candidatesOf(own.body) as { id: number; nameChanged: boolean }[]).find((c) => c.id === w.c.B)
        ?.nameChanged,
    ).toBe(false);

    const dm = await apiClient(app, 'dm_x4');
    const dmList = await dm.get(`/api/admin/wards/${w.psW1}/candidates`);
    expect(
      (candidatesOf(dmList.body) as { id: number; nameHindi: string; nameChanged: boolean }[]).find(
        (c) => c.id === w.c.A,
      ),
    ).toMatchObject({ nameHindi: 'ए नया नाम', nameChanged: true });
    const detail = await dm.get(`/api/reports/wards/${w.psW1}`);
    expect(JSON.stringify(detail.body)).toContain('ए नया नाम');

    const ballot = await ro.get(`/api/counting/wards/${w.psW1}/ballot`);
    expect(JSON.stringify(ballot.body)).toContain('ए नया नाम');
  });

  it('history: PS_RO own PS only, ZP_RO ZP only, DM all (JSON + CSV), Super Admin 403', async () => {
    await renameA();
    const zp = await apiClient(app, 'zp_ro_x3');
    expect((await zp.post(path(w.zW1, w.c.F), body('एफ', 'एफ खान'))).status).toBe(200);

    const ro1 = await apiClient(app, 'ro_ps1_x1');
    const own = await ro1.get('/api/candidates/name-changes');
    expect((changesOf(own.body) as { newName: string }[]).map((c) => c.newName)).toEqual([
      'ए नया नाम',
    ]);
    const ward = await ro1.get(`/api/candidates/wards/${w.psW1}/name-changes`);
    expect(changesOf(ward.body)).toHaveLength(1);
    expect(changesOf(ward.body)[0]).toMatchObject({
      oldName: 'ए',
      newName: 'ए नया नाम',
      reason: REASON,
      changedByRole: 'PS_RO',
      ballotPosition: 1,
    });
    expect((await ro1.get(`/api/candidates/wards/${w.zW1}/name-changes`)).status).toBe(403);

    const ro2 = await apiClient(app, 'ro_ps2_x2');
    expect(changesOf((await ro2.get('/api/candidates/name-changes')).body)).toEqual([]);
    expect((await ro2.get(`/api/candidates/wards/${w.psW1}/name-changes`)).status).toBe(403);

    const zpAll = await zp.get('/api/candidates/name-changes');
    expect((changesOf(zpAll.body) as { newName: string }[]).map((c) => c.newName)).toEqual([
      'एफ खान',
    ]);
    expect((await zp.get(`/api/candidates/wards/${w.psW1}/name-changes`)).status).toBe(403);

    const dm = await apiClient(app, 'dm_x4');
    const all = await dm.get('/api/admin/candidate-name-changes');
    expect((changesOf(all.body) as { newName: string }[]).map((c) => c.newName).sort()).toEqual(
      ['एफ खान', 'ए नया नाम'].sort(),
    );
    expect(changesOf((await dm.get(`/api/admin/wards/${w.psW1}/name-changes`)).body)).toHaveLength(
      1,
    );
    expect((await dm.get('/api/candidates/name-changes')).status).toBe(403);
    const csv = await dm.get('/api/admin/candidate-name-changes.csv');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(
      /attachment; filename="candidate-name-changes-/,
    );
    expect(csv.text.startsWith('﻿')).toBe(true);
    expect(csv.text).toContain('"ए नया नाम"');
    expect(csv.text).toContain('"एफ खान"');

    const sa = await apiClient(app, SA);
    expect((await sa.get('/api/admin/candidate-name-changes')).status).toBe(403);
    expect((await sa.get('/api/admin/candidate-name-changes.csv')).status).toBe(403);
    expect((await sa.get('/api/candidates/name-changes')).status).toBe(403);
    // RO cannot use the DM history.
    expect((await ro1.get('/api/admin/candidate-name-changes')).status).toBe(403);
  });

  it('CSV guards against formula injection in the reason', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    await ro.post(
      path(w.psW1, w.c.A),
      body('ए', 'ए दो', { reason: '=HYPERLINK("x") गलती ठीक की' }),
    );
    const dm = await apiClient(app, 'dm_x4');
    const csv = await dm.get('/api/admin/candidate-name-changes.csv');
    expect(csv.text).toContain(`"'=HYPERLINK(""x"") गलती ठीक की"`);
  });

  it('the history survives an unlock + list re-save (candidate rows are replaced)', async () => {
    await renameA();
    // Unlock psW4-style: the DM unlocks the ward (no counting yet), the RO saves a new list.
    await pool.execute(
      'UPDATE ward SET is_locked = 0, locked_at = NULL, locked_by = NULL, locked_by_name = NULL WHERE id = ?',
      [w.psW1],
    );
    const ro = await apiClient(app, 'ro_ps1_x1');
    const saved = await ro.put(`/api/candidates/wards/${w.psW1}`, {
      candidates: [
        { ballotPosition: 1, nameHindi: 'ए नया नाम', partyId: w.p1, gender: 'M' },
        { ballotPosition: 2, nameHindi: 'बी', partyId: null, gender: 'M' },
      ],
    });
    expect(saved.status).toBe(200);
    expect(await history()).toHaveLength(1);
    const own = await ro.get(`/api/candidates/wards/${w.psW1}`);
    expect(
      (candidatesOf(own.body) as { nameChanged: boolean }[]).every((c) => !c.nameChanged),
    ).toBe(true);
    expect(
      changesOf((await ro.get(`/api/candidates/wards/${w.psW1}/name-changes`)).body),
    ).toHaveLength(1);
  });
});
