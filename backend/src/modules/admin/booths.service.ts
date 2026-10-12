// DM "बूथ / वार्ड": booth name, registered voters, moving a booth to another ward, and a ward's
// reservation category. Every change needs the DM's password and a reason, and is audited with the
// old and new values.
//   - Booth name, ward move, ward category: refused once a ward involved is locked or has entries.
//   - Registered voters: allowed until the booth has a counting entry (the import:voters rule).
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { writeAudit } from '../../services/audit.js';
import { emitWardChanged } from '../../services/events.js';
import { MAX_CATEGORY_LENGTH } from '../../services/master-data/candidates.js';
import { lockWardRows, loadWard, wardHasEntries } from '../../services/master-data/lookups.js';
import { withMasterDataWrite } from '../../services/master-data/lock.js';
import { hasDevanagari, normalizeText } from '../../services/master-data/text.js';
import { requireReauth, resetFailedLogins } from '../auth/auth.service.js';
import { busyAsConflict } from './http.js';
import type { Actor } from './http.js';

const MAX_BOOTH_NAME = 300; // booth.name_hindi VARCHAR(300)
const MAX_VOTERS = 4_294_967_295; // INT UNSIGNED

interface BoothState {
  id: number;
  psId: number;
  boothNo: number;
  nameHindi: string;
  psWardId: number;
  zpWardId: number;
  male: number | null;
  female: number | null;
  total: number | null;
  hasEntry: boolean;
}

const BOOTH_SELECT = `SELECT b.id, b.panchayat_samiti_id, b.booth_no, b.name_hindi, b.ps_ward_id, b.zp_ward_id,
       b.registered_voters_male, b.registered_voters_female, b.registered_voters_total,
       EXISTS (SELECT 1 FROM booth_entry e WHERE e.booth_id = b.id) AS has_entry
  FROM booth b`;

const nullableNumber = (v: unknown): number | null => (v === null ? null : Number(v));

function toBooth(r: RowDataPacket): BoothState {
  return {
    id: Number(r.id),
    psId: Number(r.panchayat_samiti_id),
    boothNo: Number(r.booth_no),
    nameHindi: String(r.name_hindi),
    psWardId: Number(r.ps_ward_id),
    zpWardId: Number(r.zp_ward_id),
    male: nullableNumber(r.registered_voters_male),
    female: nullableNumber(r.registered_voters_female),
    total: nullableNumber(r.registered_voters_total),
    hasEntry: Number(r.has_entry) === 1,
  };
}

/** male / female / other / total; "other" is total − male − female (it is not stored separately). */
function voters(b: BoothState) {
  const other =
    b.male === null || b.female === null || b.total === null ? null : b.total - b.male - b.female;
  return { male: b.male, female: b.female, other, total: b.total };
}

async function wardFlags(db: Pool | PoolConnection, wardIds: number[]) {
  const flags = new Map<number, { wardNo: number; locked: boolean; hasEntries: boolean }>();
  for (const id of new Set(wardIds)) {
    const w = await loadWard(db, id);
    if (w)
      flags.set(id, {
        wardNo: w.ward_no,
        locked: w.is_locked === 1,
        hasEntries: await wardHasEntries(db, id),
      });
  }
  return flags;
}

/** Booths of one PS (optionally of one PS ward number), with what may still be changed. */
export async function searchBooths(pool: Pool, psId: number, psWardNo: number | null) {
  const [rows] =
    psWardNo === null
      ? await pool.execute<RowDataPacket[]>(
          `${BOOTH_SELECT} WHERE b.panchayat_samiti_id = ? ORDER BY b.booth_no`,
          [psId],
        )
      : await pool.execute<RowDataPacket[]>(
          `${BOOTH_SELECT} JOIN ward w ON w.id = b.ps_ward_id
            WHERE b.panchayat_samiti_id = ? AND w.ward_no = ? ORDER BY b.booth_no`,
          [psId, psWardNo],
        );
  const booths = rows.map(toBooth);
  const [wardRows] = await pool.execute<RowDataPacket[]>(
    `SELECT w.id, w.ward_no, w.is_locked,
            EXISTS (SELECT 1 FROM booth_entry e WHERE e.ward_id = w.id)
            OR EXISTS (SELECT 1 FROM postal_entry p WHERE p.ward_id = w.id) AS has_entries
       FROM ward w WHERE w.panchayat_samiti_id = ? OR w.ward_type = 'ZP'`,
    [psId],
  );
  const wards = new Map(
    wardRows.map((w) => [
      Number(w.id),
      {
        wardNo: Number(w.ward_no),
        frozen: Number(w.is_locked) === 1 || Number(w.has_entries) === 1,
      },
    ]),
  );
  return booths.map((b) => {
    const psWard = wards.get(b.psWardId);
    const zpWard = wards.get(b.zpWardId);
    const wardsFrozen = (psWard?.frozen ?? true) || (zpWard?.frozen ?? true);
    return {
      id: b.id,
      boothNo: b.boothNo,
      nameHindi: b.nameHindi,
      psWard: { id: b.psWardId, wardNo: psWard?.wardNo ?? 0 },
      zpWard: { id: b.zpWardId, wardNo: zpWard?.wardNo ?? 0 },
      voters: voters(b),
      hasEntry: b.hasEntry,
      /** Name and ward can change only while both wards are unlocked without entries. */
      canEditName: !wardsFrozen,
      canMove: !wardsFrozen && !b.hasEntry,
      canEditVoters: !b.hasEntry,
    };
  });
}

/** PS wards of one PS and all ZP wards: targets for a move and the category form. */
export async function listWardsForEdit(pool: Pool, psId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT w.id, w.ward_type, w.ward_no, w.reservation_category, w.is_locked,
            EXISTS (SELECT 1 FROM booth_entry e WHERE e.ward_id = w.id)
            OR EXISTS (SELECT 1 FROM postal_entry p WHERE p.ward_id = w.id) AS has_entries
       FROM ward w
      WHERE (w.ward_type = 'PS' AND w.panchayat_samiti_id = ?) OR w.ward_type = 'ZP'
      ORDER BY w.ward_type, w.ward_no`,
    [psId],
  );
  return rows.map((w) => ({
    id: Number(w.id),
    kind: w.ward_type === 'ZP' ? 'ZP' : 'PS',
    wardNo: Number(w.ward_no),
    reservationCategory: w.reservation_category === null ? null : String(w.reservation_category),
    locked: Number(w.is_locked) === 1,
    hasEntries: Number(w.has_entries) === 1,
  }));
}

async function readBoothForUpdate(conn: PoolConnection, boothId: number): Promise<BoothState> {
  const [rows] = await conn.execute<RowDataPacket[]>(`${BOOTH_SELECT} WHERE b.id = ? FOR UPDATE`, [
    boothId,
  ]);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return toBooth(row);
}

async function readBooth(pool: Pool, boothId: number): Promise<BoothState> {
  const [rows] = await pool.execute<RowDataPacket[]>(`${BOOTH_SELECT} WHERE b.id = ?`, [boothId]);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return toBooth(row);
}

/** 409 if any of the wards is locked (BALLOT_LOCKED) or has entries (COUNTING_STARTED). */
async function assertWardsOpen(conn: PoolConnection, wardIds: number[]): Promise<void> {
  for (const [, f] of await wardFlags(conn, wardIds)) {
    if (f.locked) throw new ApiError(409, 'BALLOT_LOCKED');
    if (f.hasEntries) throw new ApiError(409, 'COUNTING_STARTED');
  }
}

async function adminWrite<T>(
  pool: Pool,
  who: Actor,
  password: string,
  work: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  await requireReauth(pool, who.user.id, password, who.ip);
  return busyAsConflict(() =>
    withMasterDataWrite(pool, async (conn) => {
      await resetFailedLogins(conn, who.user.id);
      return work(conn);
    }),
  );
}

export interface BoothUpdateBody {
  nameHindi: string;
  votersMale: number;
  votersFemale: number;
  votersOther: number;
  reason: string;
  password: string;
}

/** Booth name and registered voters. The total is always computed here (male + female + other). */
export async function updateBooth(
  pool: Pool,
  who: Actor,
  boothId: number,
  body: BoothUpdateBody,
): Promise<void> {
  const name = normalizeText(body.nameHindi);
  if (name === '' || !hasDevanagari(name) || name.length > MAX_BOOTH_NAME)
    throw new ApiError(400, 'BOOTH_NAME_INVALID');
  const total = body.votersMale + body.votersFemale + body.votersOther;
  if (total > MAX_VOTERS) throw new ApiError(400, 'VALIDATION_FAILED', { details: [] });
  const before = await readBooth(pool, boothId);

  await adminWrite(pool, who, body.password, async (conn) => {
    await lockWardRows(conn, [before.psWardId, before.zpWardId]);
    const booth = await readBoothForUpdate(conn, boothId);
    if (booth.psWardId !== before.psWardId || booth.zpWardId !== before.zpWardId)
      throw new ApiError(409, 'STALE_VERSION');
    const nameChanged = booth.nameHindi !== name;
    const votersChanged =
      booth.male !== body.votersMale || booth.female !== body.votersFemale || booth.total !== total;
    if (!nameChanged && !votersChanged) throw new ApiError(409, 'NO_CHANGE');
    if (nameChanged) await assertWardsOpen(conn, [booth.psWardId, booth.zpWardId]);
    if (votersChanged && booth.hasEntry) throw new ApiError(409, 'COUNTING_STARTED');

    await conn.execute(
      `UPDATE booth SET name_hindi = ?, registered_voters_male = ?, registered_voters_female = ?,
              registered_voters_total = ? WHERE id = ?`,
      [name, body.votersMale, body.votersFemale, total, booth.id],
    );
    await writeAudit(conn, {
      userId: who.user.id,
      action: 'BOOTH_UPDATED',
      entity: 'booth',
      entityId: booth.id,
      oldValue: { name_hindi: booth.nameHindi, ...voters(booth) },
      newValue: {
        name_hindi: name,
        male: body.votersMale,
        female: body.votersFemale,
        other: body.votersOther,
        total,
      },
      reason: body.reason,
      ip: who.ip,
    });
  });
  emitWardChanged(before.psWardId);
  emitWardChanged(before.zpWardId);
}

/**
 * Moves a booth to another PS ward (of the same PS) and/or another ZP ward. Only while neither the
 * old nor the new ward (of each ballot that changes) is locked or has entries, and the booth itself
 * has no entry.
 */
export async function moveBooth(
  pool: Pool,
  who: Actor,
  boothId: number,
  body: { psWardId: number; zpWardId: number; reason: string; password: string },
): Promise<void> {
  const before = await readBooth(pool, boothId);
  const target = {
    ps: await loadWard(pool, body.psWardId),
    zp: await loadWard(pool, body.zpWardId),
  };
  if (
    target.ps?.ward_type !== 'PS' ||
    target.ps.panchayat_samiti_id !== before.psId ||
    target.zp?.ward_type !== 'ZP'
  )
    throw new ApiError(400, 'WARD_NOT_ALLOWED');
  if (before.psWardId === body.psWardId && before.zpWardId === body.zpWardId)
    throw new ApiError(409, 'NO_CHANGE');

  await adminWrite(pool, who, body.password, async (conn) => {
    // "Neither ward is locked": the old and the new ward of each ballot that changes.
    const involved = [
      ...(body.psWardId === before.psWardId ? [] : [before.psWardId, body.psWardId]),
      ...(body.zpWardId === before.zpWardId ? [] : [before.zpWardId, body.zpWardId]),
    ];
    await lockWardRows(conn, involved);
    const booth = await readBoothForUpdate(conn, boothId);
    if (booth.psWardId !== before.psWardId || booth.zpWardId !== before.zpWardId)
      throw new ApiError(409, 'STALE_VERSION');
    if (booth.hasEntry) throw new ApiError(409, 'COUNTING_STARTED');
    await assertWardsOpen(conn, involved);
    await conn.execute('UPDATE booth SET ps_ward_id = ?, zp_ward_id = ? WHERE id = ?', [
      body.psWardId,
      body.zpWardId,
      booth.id,
    ]);
    const ward = async (id: number) => (await loadWard(conn, id))?.ward_no ?? null;
    await writeAudit(conn, {
      userId: who.user.id,
      action: 'BOOTH_MOVED',
      entity: 'booth',
      entityId: booth.id,
      oldValue: {
        ps_ward_id: booth.psWardId,
        ps_ward_no: await ward(booth.psWardId),
        zp_ward_id: booth.zpWardId,
        zp_ward_no: await ward(booth.zpWardId),
      },
      newValue: {
        booth_no: booth.boothNo,
        ps_ward_id: body.psWardId,
        ps_ward_no: await ward(body.psWardId),
        zp_ward_id: body.zpWardId,
        zp_ward_no: await ward(body.zpWardId),
      },
      reason: body.reason,
      ip: who.ip,
    });
  });
  for (const id of new Set([before.psWardId, before.zpWardId, body.psWardId, body.zpWardId]))
    emitWardChanged(id);
}

/** A ward's reservation category ("" = none). */
export async function updateWardCategory(
  pool: Pool,
  who: Actor,
  wardId: number,
  body: { category: string; reason: string; password: string },
): Promise<void> {
  const category = normalizeText(body.category);
  if (category.length > MAX_CATEGORY_LENGTH) throw new ApiError(400, 'CATEGORY_TOO_LONG');
  if (!(await loadWard(pool, wardId))) throw new ApiError(404, 'NOT_FOUND');
  await adminWrite(pool, who, body.password, async (conn) => {
    await lockWardRows(conn, [wardId]);
    const ward = await loadWard(conn, wardId);
    if (!ward) throw new ApiError(404, 'NOT_FOUND');
    const next = category === '' ? null : category;
    if (ward.reservation_category === next) throw new ApiError(409, 'NO_CHANGE');
    await assertWardsOpen(conn, [wardId]);
    await conn.execute('UPDATE ward SET reservation_category = ? WHERE id = ?', [next, wardId]);
    await writeAudit(conn, {
      userId: who.user.id,
      action: 'WARD_CATEGORY_UPDATED',
      entity: 'ward',
      entityId: wardId,
      oldValue: { reservation_category: ward.reservation_category },
      newValue: { reservation_category: next },
      reason: body.reason,
      ip: who.ip,
    });
  });
  emitWardChanged(wardId);
}
