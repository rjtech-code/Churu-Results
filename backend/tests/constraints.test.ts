import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, insert, resetData } from './helpers/db.js';
import {
  addBooth,
  addBoothEntry,
  addCandidate,
  addDeclaration,
  addNota,
  addPsWard,
  addUser,
  seedBase,
} from './helpers/fixtures.js';
import type { BaseFixture } from './helpers/fixtures.js';

// All inserts go through the APP user, exactly like the running application will.
let app: Pool;
let migrator: Pool;
let f: BaseFixture;

beforeAll(() => {
  app = createTestAppPool();
  migrator = createTestMigrationPool();
});

afterAll(async () => {
  await app.end();
  await migrator.end();
});

beforeEach(async () => {
  await resetData(migrator);
  f = await seedBase(app);
});

function addVote(
  table: 'booth_entry_vote' | 'postal_entry_vote',
  entryId: number,
  wardId: number,
  candidateId: number,
  votes: number,
) {
  return insert(
    app,
    `INSERT INTO ${table} (entry_id, ward_id, candidate_id, votes) VALUES (?, ?, ?, ?)`,
    [entryId, wardId, candidateId, votes],
  );
}

function addPostalEntry(wardId: number, userId: number) {
  return insert(
    app,
    'INSERT INTO postal_entry (ward_id, sheet_total, entered_by) VALUES (?, 0, ?)',
    [wardId, userId],
  );
}

describe('votes', () => {
  it('case 2: negative votes are rejected in booth_entry_vote', async () => {
    const entry = await addBoothEntry(app, f.booth1, 'PS', f.psWard1, f.psRo1);
    await expect(addVote('booth_entry_vote', entry, f.psWard1, f.candA, -1)).rejects.toMatchObject({
      code: 'ER_WARN_DATA_OUT_OF_RANGE',
    });
    await expect(
      addVote('booth_entry_vote', entry, f.psWard1, f.candA, 0),
    ).resolves.toBeGreaterThan(0);
  });

  it('case 2: negative votes are rejected in postal_entry_vote', async () => {
    const entry = await addPostalEntry(f.psWard1, f.psRo1);
    await expect(addVote('postal_entry_vote', entry, f.psWard1, f.candA, -5)).rejects.toMatchObject(
      {
        code: 'ER_WARN_DATA_OUT_OF_RANGE',
      },
    );
  });

  it('non-integer votes are rejected', async () => {
    const entry = await addBoothEntry(app, f.booth1, 'PS', f.psWard1, f.psRo1);
    await expect(
      app.execute(
        'INSERT INTO booth_entry_vote (entry_id, ward_id, candidate_id, votes) VALUES (?, ?, ?, ?)',
        [entry, f.psWard1, f.candA, 'abc'],
      ),
    ).rejects.toMatchObject({ code: 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' });
  });

  it('a vote for a candidate of another ward is rejected', async () => {
    const entry = await addBoothEntry(app, f.booth1, 'PS', f.psWard1, f.psRo1);
    // candD belongs to psWard2; neither ward_id choice can satisfy both composite FKs.
    await expect(addVote('booth_entry_vote', entry, f.psWard1, f.candD, 1)).rejects.toMatchObject({
      code: 'ER_NO_REFERENCED_ROW_2',
    });
    await expect(addVote('booth_entry_vote', entry, f.psWard2, f.candD, 1)).rejects.toMatchObject({
      code: 'ER_NO_REFERENCED_ROW_2',
    });
  });

  it('the same candidate cannot appear twice in one entry', async () => {
    const entry = await addBoothEntry(app, f.booth1, 'PS', f.psWard1, f.psRo1);
    await addVote('booth_entry_vote', entry, f.psWard1, f.candA, 1);
    await expect(addVote('booth_entry_vote', entry, f.psWard1, f.candA, 2)).rejects.toMatchObject({
      code: 'ER_DUP_ENTRY',
    });
  });

  it('postal rejected_count is optional but never negative', async () => {
    await expect(
      insert(
        app,
        'INSERT INTO postal_entry (ward_id, sheet_total, rejected_count, entered_by) VALUES (?, 0, ?, ?)',
        [f.psWard1, -1, f.psRo1],
      ),
    ).rejects.toMatchObject({ code: 'ER_WARN_DATA_OUT_OF_RANGE' });
    const id = await addPostalEntry(f.psWard1, f.psRo1);
    const [rows] = await app.execute('SELECT rejected_count FROM postal_entry WHERE id = ?', [id]);
    expect(rows).toEqual([{ rejected_count: null }]);
  });

  it('a second postal entry for the same ward is rejected', async () => {
    await addPostalEntry(f.psWard1, f.psRo1);
    await expect(addPostalEntry(f.psWard1, f.psRo1)).rejects.toMatchObject({
      code: 'ER_DUP_ENTRY',
    });
  });
});

describe('booth entries', () => {
  it('case 3: a second entry for the same (booth, ballot_for) is rejected', async () => {
    await addBoothEntry(app, f.booth1, 'PS', f.psWard1, f.psRo1);
    await expect(addBoothEntry(app, f.booth1, 'PS', f.psWard1, f.psRo1)).rejects.toMatchObject({
      code: 'ER_DUP_ENTRY',
    });
  });

  it('case 4: the same booth can have one PS entry and one ZP entry', async () => {
    await expect(addBoothEntry(app, f.booth1, 'PS', f.psWard1, f.psRo1)).resolves.toBeGreaterThan(
      0,
    );
    await expect(addBoothEntry(app, f.booth1, 'ZP', f.zpWard1, f.zpRo)).resolves.toBeGreaterThan(0);
  });

  it('an entry pointing at a ward that is not the booth ward is rejected (trigger)', async () => {
    // zpWard2 is a ZP ward, but not booth1's ZP ward.
    await expect(addBoothEntry(app, f.booth1, 'ZP', f.zpWard2, f.zpRo)).rejects.toMatchObject({
      code: 'ER_SIGNAL_EXCEPTION',
    });
    // psWard2 is a PS ward of another PS.
    await expect(addBoothEntry(app, f.booth1, 'PS', f.psWard2, f.psRo1)).rejects.toMatchObject({
      code: 'ER_SIGNAL_EXCEPTION',
    });
  });

  it('a PS entry cannot point at a ZP ward', async () => {
    // The BEFORE INSERT trigger runs before FK checks, so it is the layer that reports this.
    await expect(addBoothEntry(app, f.booth1, 'PS', f.zpWard1, f.psRo1)).rejects.toMatchObject({
      code: 'ER_SIGNAL_EXCEPTION',
    });
    // Second line of defence: (ward_id, ballot_for) must reference ward (id, ward_type).
    const [rows] = await migrator.query(
      `SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS cols,
              GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) AS refs
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_booth_entry_ward_type'`,
    );
    expect(rows).toEqual([{ cols: 'ward_id,ballot_for', refs: 'id,ward_type' }]);
  });

  it('updating an entry to a wrong ward is rejected (trigger)', async () => {
    const entry = await addBoothEntry(app, f.booth1, 'ZP', f.zpWard1, f.zpRo);
    await expect(
      app.execute('UPDATE booth_entry SET ward_id = ? WHERE id = ?', [f.zpWard2, entry]),
    ).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' });
  });
});

describe('candidates', () => {
  it('case 5: two candidates with the same ballot_position in one ward are rejected', async () => {
    await expect(addCandidate(app, f.psWard1, 1, 'दूसरा', null)).rejects.toMatchObject({
      code: 'ER_DUP_ENTRY',
    });
  });

  it('case 6: a second NOTA in the same ward is rejected; NOTA in another ward is fine', async () => {
    await expect(addNota(app, f.psWard1, 9)).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    await expect(addNota(app, f.psWard2, 9)).resolves.toBeGreaterThan(0);
  });

  it('NOTA cannot have a party', async () => {
    await expect(
      insert(
        app,
        'INSERT INTO candidate (ward_id, ballot_position, name_hindi, party_id, is_nota) VALUES (?, 9, ?, ?, 1)',
        [f.psWard2, 'नोटा', f.party],
      ),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
  });

  it('case 12: deleting a party used by a candidate is rejected', async () => {
    await expect(app.execute('DELETE FROM party WHERE id = ?', [f.party])).rejects.toMatchObject({
      code: 'ER_ROW_IS_REFERENCED_2',
    });
  });
});

describe('geography', () => {
  it('case 7: duplicate booth_no in the same PS is rejected', async () => {
    await expect(addBooth(app, f.ps1, 1, f.psWard1, f.zpWard1)).rejects.toMatchObject({
      code: 'ER_DUP_ENTRY',
    });
  });

  it('case 7: the same booth_no in a different PS is allowed', async () => {
    await expect(addBooth(app, f.ps2, 1, f.psWard2, f.zpWard1)).resolves.toBeGreaterThan(0);
  });

  it('a booth whose PS ward belongs to another PS is rejected', async () => {
    await expect(addBooth(app, f.ps1, 2, f.psWard2, f.zpWard1)).rejects.toMatchObject({
      code: 'ER_NO_REFERENCED_ROW_2',
    });
  });

  it('a ZP ward cannot be used as a booth PS ward, nor a PS ward as its ZP ward', async () => {
    await expect(addBooth(app, f.ps1, 2, f.zpWard1, f.zpWard1)).rejects.toMatchObject({
      code: 'ER_NO_REFERENCED_ROW_2',
    });
    await expect(addBooth(app, f.ps1, 2, f.psWard1, f.psWard1)).rejects.toMatchObject({
      code: 'ER_NO_REFERENCED_ROW_2',
    });
  });

  it('PS ward numbers are unique per PS; ZP ward numbers unique in the district', async () => {
    await expect(addPsWard(app, f.districtId, f.ps1, 1)).rejects.toMatchObject({
      code: 'ER_DUP_ENTRY',
    });
    await expect(addPsWard(app, f.districtId, f.ps1, 2)).resolves.toBeGreaterThan(0);
    await expect(
      insert(app, "INSERT INTO ward (ward_type, district_id, ward_no) VALUES ('ZP', ?, 1)", [
        f.districtId,
      ]),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  it('wards default to not unopposed with no reservation category', async () => {
    const [rows] = await app.execute(
      'SELECT is_unopposed, reservation_category FROM ward WHERE id = ?',
      [f.psWard1],
    );
    expect(rows).toEqual([{ is_unopposed: 0, reservation_category: null }]);
    await expect(
      app.execute('UPDATE ward SET is_unopposed = 2 WHERE id = ?', [f.psWard1]),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
  });

  it('a PS ward without a PS (or a ZP ward with one) is rejected', async () => {
    await expect(
      insert(app, "INSERT INTO ward (ward_type, district_id, ward_no) VALUES ('PS', ?, 5)", [
        f.districtId,
      ]),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
    await expect(
      insert(
        app,
        "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) VALUES ('ZP', ?, ?, 5)",
        [f.districtId, f.ps1],
      ),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
  });
});

describe('users', () => {
  it('case 8: a PS_RO without panchayat_samiti_id is rejected', async () => {
    await expect(addUser(app, 'ro_x', 'PS_RO', null)).rejects.toMatchObject({
      code: 'ER_CHECK_CONSTRAINT_VIOLATED',
    });
  });

  it('case 8: a DM (or ZP_RO) with a panchayat_samiti_id is rejected', async () => {
    await expect(addUser(app, 'dm_x', 'DM', f.ps1)).rejects.toMatchObject({
      code: 'ER_CHECK_CONSTRAINT_VIOLATED',
    });
    await expect(addUser(app, 'zp_x', 'ZP_RO', f.ps1)).rejects.toMatchObject({
      code: 'ER_CHECK_CONSTRAINT_VIOLATED',
    });
  });

  it('roles other than PS_RO / ZP_RO / DM are rejected', async () => {
    await expect(addUser(app, 'admin', 'ADMIN', null)).rejects.toMatchObject({
      code: 'WARN_DATA_TRUNCATED',
    });
  });

  it('only one active PS_RO per PS, one ZP_RO and one DM', async () => {
    await expect(addUser(app, 'ro_churu_2', 'PS_RO', f.ps1)).rejects.toMatchObject({
      code: 'ER_DUP_ENTRY',
    });
    await expect(addUser(app, 'dm_2', 'DM', null)).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    await expect(addUser(app, 'ro_zp_2', 'ZP_RO', null)).rejects.toMatchObject({
      code: 'ER_DUP_ENTRY',
    });
    // After deactivating the old officer, a replacement can be created.
    await app.execute('UPDATE users SET is_active = 0 WHERE id = ?', [f.psRo1]);
    await expect(addUser(app, 'ro_churu_2', 'PS_RO', f.ps1)).resolves.toBeGreaterThan(0);
  });
});

describe('ward_declarations', () => {
  it('case 9: a duplicate (ward, version) is rejected', async () => {
    await addDeclaration(app, { wardId: f.psWard1, version: 1, winner: f.candA, userId: f.psRo1 });
    await expect(
      addDeclaration(app, { wardId: f.psWard1, version: 1, winner: f.candB, userId: f.psRo1 }),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  it('a correction (version > 1) needs a reason; version 1 must not have one', async () => {
    await addDeclaration(app, { wardId: f.psWard1, version: 1, winner: f.candA, userId: f.psRo1 });
    await expect(
      addDeclaration(app, { wardId: f.psWard1, version: 2, winner: f.candB, userId: f.psRo1 }),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
    await expect(
      addDeclaration(
        app,
        { wardId: f.psWard1, version: 2, winner: f.candB, userId: f.psRo1 },
        { reason: '   ' },
      ),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
    await expect(
      addDeclaration(
        app,
        { wardId: f.psWard1, version: 2, winner: f.candB, userId: f.psRo1 },
        { reason: 'टाइपिंग त्रुटि सुधार' },
      ),
    ).resolves.toBeGreaterThan(0);
    await expect(
      addDeclaration(
        app,
        { wardId: f.psWard2, version: 1, winner: f.candD, userId: f.psRo1 },
        { reason: 'x' },
      ),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
  });

  it('lottery details exist exactly for TIE_RESOLVED (Part 6 CHECK)', async () => {
    const decl = { wardId: f.psWard1, version: 1, winner: f.candA, userId: f.psRo1 };
    await expect(
      addDeclaration(app, decl, { status: 'TIE_RESOLVED', margin: 0, lottery: null }),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
    await expect(
      addDeclaration(app, decl, {
        status: 'DECLARED',
        margin: 5,
        lottery: { winnerCandidateId: f.candA },
      }),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
    await expect(
      app.execute(
        `INSERT INTO ward_declarations (ward_id, version, status, winner_candidate_id, margin, snapshot, declared_by, nota_highest_ack)
         VALUES (?, 1, 'DECLARED', ?, 5, '{}', ?, 2)`,
        [f.psWard1, f.candA, f.psRo1],
      ),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
  });

  it('NOTA can never be the winner', async () => {
    await expect(
      addDeclaration(app, { wardId: f.psWard1, version: 1, winner: f.notaPs1, userId: f.psRo1 }),
    ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
  });

  it('the winner must be a candidate of the same ward', async () => {
    await expect(
      addDeclaration(app, { wardId: f.psWard1, version: 1, winner: f.candD, userId: f.psRo1 }),
    ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
  });

  it('DECLARED needs margin > 0; TIE_RESOLVED needs margin = 0', async () => {
    await expect(
      addDeclaration(
        app,
        { wardId: f.psWard1, version: 1, winner: f.candA, userId: f.psRo1 },
        { margin: 0 },
      ),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
    await expect(
      addDeclaration(
        app,
        { wardId: f.psWard1, version: 1, winner: f.candA, userId: f.psRo1 },
        { status: 'TIE_RESOLVED', margin: 3 },
      ),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
    await expect(
      addDeclaration(
        app,
        { wardId: f.psWard1, version: 1, winner: f.candA, userId: f.psRo1 },
        { status: 'TIE_RESOLVED', margin: 0 },
      ),
    ).resolves.toBeGreaterThan(0);
  });
});

describe('session settings', () => {
  it('app connections run in strict SQL mode at +05:30', async () => {
    const [rows] = await app.query('SELECT @@SESSION.sql_mode AS mode, @@SESSION.time_zone AS tz');
    expect(rows).toEqual([
      { mode: expect.stringContaining('STRICT_ALL_TABLES') as unknown, tz: '+05:30' },
    ]);
  });
});
