// Super Admin: add or delete one booth. Only while BOTH of its wards (PS and ZP) are untouched: no
// booth or postal entry, no voided entry and no declaration. The same checks run twice: before the
// backup (checkBoothAdd / checkBoothDelete, so a refused action never makes a backup) and again inside
// the one transaction under the master-data lock. One audit row.
import type { Connection, Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { emitWardChanged } from '../events.js';
import { lockWardRows } from '../master-data/lookups.js';
import { withMasterDataWrite } from '../master-data/lock.js';
import { hasDevanagari, normalizeText } from '../master-data/text.js';
import { writeAudit } from './audit.js';
import type { AuditActor } from './audit.js';
import { assertCountingUnlocked } from './counting-lock.js';

const MAX_BOOTH_NAME = 300; // booth.name_hindi / name_english VARCHAR(300)

export interface NewBooth {
  psId: number;
  boothNo: number;
  nameHindi: string;
  nameEnglish: string | null;
  psWardNo: number;
  zpWardNo: number;
  votersMale: number;
  votersFemale: number;
  votersOther: number;
}

/** 409 WARD_HAS_ENTRIES when any of the wards has counting data or a declaration. */
async function assertWardsUntouched(conn: Pool | Connection, wardIds: number[]): Promise<void> {
  for (const wardId of new Set(wardIds)) {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT EXISTS (SELECT 1 FROM booth_entry WHERE ward_id = ?)
           OR EXISTS (SELECT 1 FROM postal_entry WHERE ward_id = ?)
           OR EXISTS (SELECT 1 FROM voided_entry WHERE ward_id = ?)
           OR EXISTS (SELECT 1 FROM ward_declarations WHERE ward_id = ?) AS touched`,
      [wardId, wardId, wardId, wardId],
    );
    if (Number(rows[0]?.touched) === 1) throw new ApiError(409, 'WARD_HAS_ENTRIES');
  }
}

async function wardId(
  conn: Pool | Connection,
  type: 'PS' | 'ZP',
  psId: number | null,
  wardNo: number,
): Promise<number> {
  const [rows] =
    type === 'PS'
      ? await conn.execute<RowDataPacket[]>(
          "SELECT id FROM ward WHERE ward_type = 'PS' AND panchayat_samiti_id = ? AND ward_no = ?",
          [psId, wardNo],
        )
      : await conn.execute<RowDataPacket[]>(
          "SELECT id FROM ward WHERE ward_type = 'ZP' AND ward_no = ?",
          [wardNo],
        );
  if (rows[0] === undefined)
    throw new ApiError(404, type === 'PS' ? 'PS_WARD_NOT_FOUND' : 'ZP_WARD_NOT_FOUND');
  return Number(rows[0].id);
}

function cleanName(raw: string | null, needHindi: boolean): string | null {
  const name = raw === null ? '' : normalizeText(raw);
  if (name === '') {
    if (needHindi) throw new ApiError(400, 'BOOTH_NAME_INVALID');
    return null;
  }
  if (name.length > MAX_BOOTH_NAME || (needHindi && !hasDevanagari(name)))
    throw new ApiError(400, 'BOOTH_NAME_INVALID');
  return name;
}

/** Every refusal of an add, before anything is written (also re-run inside the transaction). */
export async function checkBoothAdd(db: Pool | Connection, booth: NewBooth) {
  const nameHindi = cleanName(booth.nameHindi, true) ?? '';
  const nameEnglish = cleanName(booth.nameEnglish, false);
  await assertCountingUnlocked(db);
  const [ps] = await db.execute<RowDataPacket[]>('SELECT id FROM panchayat_samiti WHERE id = ?', [
    booth.psId,
  ]);
  if (ps[0] === undefined) throw new ApiError(404, 'PS_NOT_FOUND');
  const psWardId = await wardId(db, 'PS', booth.psId, booth.psWardNo);
  const zpWardId = await wardId(db, 'ZP', null, booth.zpWardNo);
  await assertWardsUntouched(db, [psWardId, zpWardId]);
  const [same] = await db.execute<RowDataPacket[]>(
    'SELECT id FROM booth WHERE panchayat_samiti_id = ? AND booth_no = ?',
    [booth.psId, booth.boothNo],
  );
  if (same[0] !== undefined) throw new ApiError(409, 'BOOTH_EXISTS');
  return { nameHindi, nameEnglish, psWardId, zpWardId };
}

export async function addBooth(pool: Pool, actor: AuditActor, booth: NewBooth): Promise<number> {
  const total = booth.votersMale + booth.votersFemale + booth.votersOther;
  const ids = await withMasterDataWrite(pool, async (conn) => {
    const { nameHindi, nameEnglish, psWardId, zpWardId } = await checkBoothAdd(conn, booth);
    await lockWardRows(conn, [psWardId, zpWardId]);
    await assertWardsUntouched(conn, [psWardId, zpWardId]);
    const [inserted] = await conn.execute<ResultSetHeader>(
      `INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, name_english, ps_ward_id, zp_ward_id,
                          registered_voters_male, registered_voters_female, registered_voters_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        booth.psId,
        booth.boothNo,
        nameHindi,
        nameEnglish,
        psWardId,
        zpWardId,
        booth.votersMale,
        booth.votersFemale,
        total,
      ],
    );
    await writeAudit(
      conn,
      {
        action: 'BOOTH_ADDED',
        entity: 'booth',
        entityId: inserted.insertId,
        newValue: {
          panchayat_samiti_id: booth.psId,
          booth_no: booth.boothNo,
          name_hindi: nameHindi,
          name_english: nameEnglish,
          ps_ward_no: booth.psWardNo,
          zp_ward_no: booth.zpWardNo,
          male: booth.votersMale,
          female: booth.votersFemale,
          other: booth.votersOther,
          total,
        },
      },
      actor,
    );
    return { boothId: inserted.insertId, psWardId, zpWardId };
  });
  emitWardChanged(ids.psWardId);
  emitWardChanged(ids.zpWardId);
  return ids.boothId;
}

/** Every refusal of a delete, before anything is written (also re-run inside the transaction). */
export async function checkBoothDelete(
  db: Pool | Connection,
  boothId: number,
  confirmBoothNo: string,
) {
  await assertCountingUnlocked(db);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT b.id, b.panchayat_samiti_id, b.booth_no, b.name_hindi, b.name_english, b.ps_ward_id,
            b.zp_ward_id, b.registered_voters_male, b.registered_voters_female,
            b.registered_voters_total, pw.ward_no AS ps_ward_no, zw.ward_no AS zp_ward_no
       FROM booth b JOIN ward pw ON pw.id = b.ps_ward_id JOIN ward zw ON zw.id = b.zp_ward_id
      WHERE b.id = ?`,
    [boothId],
  );
  const b = rows[0];
  if (b === undefined) throw new ApiError(404, 'NOT_FOUND');
  if (confirmBoothNo.trim() !== String(b.booth_no)) throw new ApiError(400, 'CONFIRM_MISMATCH');
  await assertWardsUntouched(db, [Number(b.ps_ward_id), Number(b.zp_ward_id)]);
  return b;
}

/** `confirmBoothNo` must be the booth's number, typed by the Super Admin. */
export async function deleteBooth(
  pool: Pool,
  actor: AuditActor,
  boothId: number,
  confirmBoothNo: string,
): Promise<void> {
  const wards = await withMasterDataWrite(pool, async (conn) => {
    const b = await checkBoothDelete(conn, boothId, confirmBoothNo);
    const psWardId = Number(b.ps_ward_id);
    const zpWardId = Number(b.zp_ward_id);
    await lockWardRows(conn, [psWardId, zpWardId]);
    await assertWardsUntouched(conn, [psWardId, zpWardId]);
    await conn.execute('DELETE FROM booth WHERE id = ?', [boothId]);
    await writeAudit(
      conn,
      {
        action: 'BOOTH_DELETED',
        entity: 'booth',
        entityId: boothId,
        oldValue: {
          panchayat_samiti_id: Number(b.panchayat_samiti_id),
          booth_no: Number(b.booth_no),
          name_hindi: String(b.name_hindi),
          name_english: b.name_english === null ? null : String(b.name_english),
          ps_ward_no: Number(b.ps_ward_no),
          zp_ward_no: Number(b.zp_ward_no),
          male: b.registered_voters_male === null ? null : Number(b.registered_voters_male),
          female: b.registered_voters_female === null ? null : Number(b.registered_voters_female),
          total: b.registered_voters_total === null ? null : Number(b.registered_voters_total),
        },
        newValue: null,
      },
      actor,
    );
    return [psWardId, zpWardId];
  });
  for (const id of wards) emitWardChanged(id);
}

/** Booths of one PS for the panel list, with whether they can still be deleted. */
export async function listBooths(pool: Pool, psId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT b.id, b.booth_no, b.name_hindi, pw.ward_no AS ps_ward_no, zw.ward_no AS zp_ward_no,
            b.registered_voters_total,
            (SELECT COUNT(*) FROM ward w WHERE w.id IN (b.ps_ward_id, b.zp_ward_id) AND (
                EXISTS (SELECT 1 FROM booth_entry e WHERE e.ward_id = w.id)
             OR EXISTS (SELECT 1 FROM postal_entry p WHERE p.ward_id = w.id)
             OR EXISTS (SELECT 1 FROM voided_entry v WHERE v.ward_id = w.id)
             OR EXISTS (SELECT 1 FROM ward_declarations d WHERE d.ward_id = w.id))) AS touched
       FROM booth b JOIN ward pw ON pw.id = b.ps_ward_id JOIN ward zw ON zw.id = b.zp_ward_id
      WHERE b.panchayat_samiti_id = ? ORDER BY b.booth_no`,
    [psId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    boothNo: Number(r.booth_no),
    nameHindi: String(r.name_hindi),
    psWardNo: Number(r.ps_ward_no),
    zpWardNo: Number(r.zp_ward_no),
    votersTotal: r.registered_voters_total === null ? null : Number(r.registered_voters_total),
    canDelete: Number(r.touched) === 0,
  }));
}

/** The wards a new booth of this PS can go to, each with whether it is still open for booth changes. */
export async function wardsForBooths(pool: Pool, psId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT w.id, w.ward_type, w.ward_no,
            (EXISTS (SELECT 1 FROM booth_entry e WHERE e.ward_id = w.id)
             OR EXISTS (SELECT 1 FROM postal_entry p WHERE p.ward_id = w.id)
             OR EXISTS (SELECT 1 FROM voided_entry v WHERE v.ward_id = w.id)
             OR EXISTS (SELECT 1 FROM ward_declarations d WHERE d.ward_id = w.id)) AS touched
       FROM ward w
      WHERE (w.ward_type = 'PS' AND w.panchayat_samiti_id = ?) OR w.ward_type = 'ZP'
      ORDER BY w.ward_type, w.ward_no`,
    [psId],
  );
  const pick = (type: 'PS' | 'ZP') =>
    rows
      .filter((r) => r.ward_type === type)
      .map((r) => ({ wardNo: Number(r.ward_no), open: Number(r.touched) === 0 }));
  return { psWards: pick('PS'), zpWards: pick('ZP') };
}
