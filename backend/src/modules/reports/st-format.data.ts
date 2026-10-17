// Reads what the ST Format files need: the DM report read (votes from the result engine) plus the
// private details (date of birth / age, education, mobile, category) of the candidates. Read only.
// The details are read separately from the report snapshot; they never change a vote number.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { detailsFromRow } from '../../services/master-data/candidate-details.js';
import type { CandidateDetails } from '../../services/master-data/candidate-details.js';
import { buildStFormatPs } from '../../services/st-format-ps.js';
import type { PsName, StFormatPs } from '../../services/st-format-ps.js';
import { buildStFormatZp } from '../../services/st-format-zp.js';
import type { StFormatZp } from '../../services/st-format-zp.js';
import { readReportData } from './reports.data.js';

async function readDetails(
  pool: Pool,
  wardType: 'PS' | 'ZP',
): Promise<Map<number, CandidateDetails>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT c.id, DATE_FORMAT(c.dob, '%Y-%m-%d') AS dob, c.age_stated, c.education, c.mobile,
            c.candidate_category
       FROM candidate c JOIN ward w ON w.id = c.ward_id
      WHERE w.ward_type = ? AND c.is_nota = 0`,
    [wardType],
  );
  return new Map(rows.map((r) => [Number(r.id), detailsFromRow(r)]));
}

export async function readStFormatZp(pool: Pool): Promise<StFormatZp> {
  const raw = await readReportData(pool);
  return buildStFormatZp(raw, await readDetails(pool, 'ZP'));
}

/** PS names in English (the format is in English), by id. */
export async function readPsNames(pool: Pool): Promise<PsName[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, name_english FROM panchayat_samiti ORDER BY id',
  );
  return rows.map((r) => ({ id: Number(r.id), nameEnglish: String(r.name_english) }));
}

/** `psId` null = all PS. An unknown PS id is 404. */
export async function readStFormatPs(pool: Pool, psId: number | null): Promise<StFormatPs> {
  const psNames = await readPsNames(pool);
  if (psId !== null && !psNames.some((p) => p.id === psId)) throw new ApiError(404, 'NOT_FOUND');
  const raw = await readReportData(pool);
  return buildStFormatPs(raw, await readDetails(pool, 'PS'), psNames, psId);
}
