import type { Pool } from 'mysql2/promise';
import { insert } from './db.js';

/** A tiny, valid slice of the district used by constraint tests. */
export interface BaseFixture {
  districtId: number;
  ps1: number;
  ps2: number;
  psWard1: number; // PS ward 1 of ps1
  psWard2: number; // PS ward 1 of ps2
  zpWard1: number;
  zpWard2: number;
  booth1: number; // ps1 booth 1 -> psWard1 / zpWard1
  psRo1: number;
  zpRo: number;
  dm: number;
  party: number;
  candA: number; // psWard1, position 1
  candB: number; // psWard1, position 2
  notaPs1: number; // psWard1, position 3
  candC: number; // zpWard1, position 1
  notaZp1: number; // zpWard1, position 2
  candD: number; // psWard2, position 1
}

const HASH = '$2b$12$abcdefghijklmnopqrstuuK8i7x1wZ0yYp4k2s9mA3Qe5rT6uVw7W';

export function addPs(pool: Pool, districtId: number, nameEn: string, nameHi: string) {
  return insert(
    pool,
    'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) VALUES (?, ?, ?)',
    [districtId, nameEn, nameHi],
  );
}

export function addPsWard(pool: Pool, districtId: number, psId: number, wardNo: number) {
  return insert(
    pool,
    "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) VALUES ('PS', ?, ?, ?)",
    [districtId, psId, wardNo],
  );
}

export function addZpWard(pool: Pool, districtId: number, wardNo: number) {
  return insert(
    pool,
    "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) VALUES ('ZP', ?, NULL, ?)",
    [districtId, wardNo],
  );
}

export function addBooth(
  pool: Pool,
  psId: number,
  boothNo: number,
  psWardId: number,
  zpWardId: number,
) {
  return insert(
    pool,
    'INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id) VALUES (?, ?, ?, ?, ?)',
    [psId, boothNo, `बूथ ${boothNo}`, psWardId, zpWardId],
  );
}

export function addUser(pool: Pool, username: string, role: string, psId: number | null) {
  return insert(
    pool,
    'INSERT INTO users (username, password_hash, role, panchayat_samiti_id) VALUES (?, ?, ?, ?)',
    [username, HASH, role, psId],
  );
}

export function addCandidate(
  pool: Pool,
  wardId: number,
  position: number,
  name: string,
  partyId: number | null,
) {
  return insert(
    pool,
    "INSERT INTO candidate (ward_id, ballot_position, name_hindi, party_id, gender, is_nota) VALUES (?, ?, ?, ?, 'M', 0)",
    [wardId, position, name, partyId],
  );
}

export function addNota(pool: Pool, wardId: number, position: number) {
  return insert(
    pool,
    "INSERT INTO candidate (ward_id, ballot_position, name_hindi, party_id, gender, is_nota) VALUES (?, ?, 'नोटा', NULL, NULL, 1)",
    [wardId, position],
  );
}

export function addBoothEntry(
  pool: Pool,
  boothId: number,
  ballotFor: 'PS' | 'ZP',
  wardId: number,
  userId: number,
  sheetTotal = 0,
) {
  return insert(
    pool,
    'INSERT INTO booth_entry (booth_id, ballot_for, ward_id, round_no, sheet_total, entered_by) VALUES (?, ?, ?, 1, ?, ?)',
    [boothId, ballotFor, wardId, sheetTotal, userId],
  );
}

export function addDeclaration(
  pool: Pool,
  f: { wardId: number; version: number; winner: number; userId: number },
  overrides: { status?: string; margin?: number; reason?: string | null; lottery?: unknown } = {},
) {
  const status = overrides.status ?? 'DECLARED';
  // A TIE_RESOLVED declaration records its lottery (CHECK since Part 6); pass `lottery` to override.
  const lottery =
    overrides.lottery !== undefined
      ? overrides.lottery
      : status === 'TIE_RESOLVED'
        ? { winnerCandidateId: f.winner, conductedBy: 'Fixture', note: 'Fixture lottery' }
        : null;
  return insert(
    pool,
    `INSERT INTO ward_declarations
       (ward_id, version, status, winner_candidate_id, margin, snapshot, lottery_details, declared_by, correction_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      f.wardId,
      f.version,
      status,
      f.winner,
      overrides.margin ?? 10,
      JSON.stringify({ candidates: [] }),
      lottery === null ? null : JSON.stringify(lottery),
      f.userId,
      overrides.reason === undefined ? null : overrides.reason,
    ],
  );
}

export async function seedBase(pool: Pool): Promise<BaseFixture> {
  const districtId = await insert(
    pool,
    'INSERT INTO district (code, name_english, name_hindi) VALUES (?, ?, ?)',
    ['CHURU', 'Churu', 'चूरू'],
  );
  const ps1 = await addPs(pool, districtId, 'Churu', 'चूरू');
  const ps2 = await addPs(pool, districtId, 'Rajgarh', 'राजगढ़');
  const psWard1 = await addPsWard(pool, districtId, ps1, 1);
  const psWard2 = await addPsWard(pool, districtId, ps2, 1);
  const zpWard1 = await addZpWard(pool, districtId, 1);
  const zpWard2 = await addZpWard(pool, districtId, 2);
  const booth1 = await addBooth(pool, ps1, 1, psWard1, zpWard1);
  const psRo1 = await addUser(pool, 'ro_churu', 'PS_RO', ps1);
  const zpRo = await addUser(pool, 'ro_zp', 'ZP_RO', null);
  const dm = await addUser(pool, 'dm', 'DM', null);
  const party = await insert(
    pool,
    'INSERT INTO party (name_hindi, name_english, short_name, symbol) VALUES (?, ?, ?, ?)',
    ['पार्टी एक', 'Party One', 'P1', 'कमल'],
  );
  const candA = await addCandidate(pool, psWard1, 1, 'उम्मीदवार ए', party);
  const candB = await addCandidate(pool, psWard1, 2, 'उम्मीदवार बी', null);
  const notaPs1 = await addNota(pool, psWard1, 3);
  const candC = await addCandidate(pool, zpWard1, 1, 'उम्मीदवार सी', party);
  const notaZp1 = await addNota(pool, zpWard1, 2);
  const candD = await addCandidate(pool, psWard2, 1, 'उम्मीदवार डी', null);
  return {
    districtId,
    ps1,
    ps2,
    psWard1,
    psWard2,
    zpWard1,
    zpWard2,
    booth1,
    psRo1,
    zpRo,
    dm,
    party,
    candA,
    candB,
    notaPs1,
    candC,
    notaZp1,
    candD,
  };
}
