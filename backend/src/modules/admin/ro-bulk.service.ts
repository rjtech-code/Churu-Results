// DM "RO सूची" Excel tools: the bulk-add template, "जाँच" (preview, writes nothing), "सेव" (ONE
// transaction; every account through createSeatAccountIn, the same code as "नया RO बनाएँ"), and the
// RO details download (by default without passwords; with passwords only after the DM's password).
// New passwords exist only in the save response (no-store) and its credentials file; they are
// never stored in clear, logged or audited.
import type { Pool, PoolConnection } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { writeAudit } from '../../services/audit.js';
import type { HindiIssue } from '../../services/master-data/issues-hi.js';
import { psHi } from '../../services/master-data/issues-hi.js';
import { withReadOnly } from '../../services/master-data/lock.js';
import type { PsRow } from '../../services/master-data/lookups.js';
import {
  RO_BULK_COLUMNS,
  RO_BULK_COLUMN_NOTES,
  RO_BULK_MAX_ROWS,
  RO_BULK_SHEET,
  ZP_LABEL,
  checkRoRows,
  roBulkTotals,
} from '../../services/master-data/ro-bulk.js';
import type { RoBulkRow, RoBulkTotals } from '../../services/master-data/ro-bulk.js';
import { writeSheetToBuffer } from '../../services/master-data/xlsx.js';
import type { Cell, SheetRow, SheetSpec } from '../../services/master-data/xlsx.js';
import { formatIst } from '../../services/setup/report.js';
import { istStampForFile, neutralizeText } from '../reports/csv.js';
import type { Actor } from './http.js';
import { checkFailed, readUpload, safeFileName } from './uploads.service.js';
import type { UploadBody } from './uploads.service.js';
import {
  createSeatAccountIn,
  currentPassword,
  inUserWrite,
  loadRoAccounts,
  parseSeat,
  psInPageOrder,
} from './users.service.js';
import type { AccountRow } from './users.service.js';

export const CONFIDENTIAL_NOTICE =
  'गोपनीय — इस फ़ाइल में RO के पासवर्ड हैं। इसे किसी को न भेजें, प्रिंट या कॉपी न छोड़ें; काम होते ही फ़ाइल हटा दें।';

/** A downloaded file inside a JSON answer (only for files that carry passwords: POST + no-store). */
export interface FileDownload {
  fileName: string;
  fileBase64: string;
}

/**
 * Free text typed by people (names) is neutralized against formula injection (= + - @ at the start).
 * Passwords are written exactly as they are: exceljs stores them as plain text (never a formula),
 * and a leading apostrophe would change the password the RO has to type.
 */
const safe = (text: string | null): string | null => (text === null ? null : neutralizeText(text));

const asDownload = async (sheets: SheetSpec[], fileName: string): Promise<FileDownload> => ({
  fileName,
  fileBase64: (await writeSheetToBuffer(sheets)).toString('base64'),
});

// ---------------------------------------------------------------- template

/** The empty bulk-add file: a note row and an EXAMPLE row (both must be deleted), dropdowns. */
export async function roBulkTemplate(pool: Pool): Promise<Buffer> {
  const psList = await psInPageOrder(pool);
  const headers = [...RO_BULK_COLUMNS];
  const sheets: SheetSpec[] = [
    {
      name: RO_BULK_SHEET,
      headers,
      rows: [
        headers.map(
          (c, i) => `${i === 0 ? 'EXAMPLE note (यह row हटाएँ): ' : ''}${RO_BULK_COLUMN_NOTES[c]}`,
        ),
        [
          'PS',
          psList[0]?.name_english ?? 'CHURU PANCHAYAT SAMITI',
          'EXAMPLE - RO का नाम',
          '9876543210',
        ],
      ],
      dropdowns: [
        { column: 'election', formula: '"PS,ZP"', rows: RO_BULK_MAX_ROWS },
        ...(psList.length === 0
          ? []
          : [
              {
                column: 'panchayat_samiti',
                formula: `lists!$A$2:$A$${String(psList.length + 1)}`,
                rows: RO_BULK_MAX_ROWS,
              },
            ]),
      ],
    },
    {
      name: 'lists',
      headers: ['panchayat_samiti'],
      rows: psList.map((ps) => [ps.name_english]),
      hidden: true,
    },
  ];
  return writeSheetToBuffer(sheets);
}

// ---------------------------------------------------------------- check / save

export interface RoBulkCheck {
  /** false: the file itself could not be used (see errors). */
  ok: boolean;
  errors: HindiIssue[];
  rows: RoBulkRow[];
  totals: RoBulkTotals;
  /** The seats that "सेव" will create, sent back with the save so a changed list is refused. */
  expectedSeats: string[];
  sha256: string;
}

async function checkOn(conn: Pool | PoolConnection, rows: readonly SheetRow[]) {
  const psList = await psInPageOrder(conn);
  const checked = checkRoRows(rows, psList, await loadRoAccounts(conn));
  return { psList, checked };
}

const newSeats = (rows: readonly RoBulkRow[]): string[] =>
  rows.flatMap((r) => (r.status === 'NEW' && r.seat !== null ? [r.seat] : [])).sort();

export async function checkRoBulk(pool: Pool, body: UploadBody): Promise<RoBulkCheck> {
  const file = await readUpload(body, RO_BULK_COLUMNS, [], RO_BULK_MAX_ROWS);
  const empty = { rows: [], totals: roBulkTotals([]), expectedSeats: [], sha256: file.sha256 };
  if (file.rows === null) return { ok: false, errors: file.errors, ...empty };
  const sheetRows = file.rows;
  const { checked } = await withReadOnly(pool, (conn) => checkOn(conn, sheetRows));
  return {
    ok: true,
    errors: [],
    rows: checked,
    totals: roBulkTotals(checked),
    expectedSeats: newSeats(checked),
    sha256: file.sha256,
  };
}

export interface CreatedRo {
  seatLabel: string;
  fullName: string;
  phone: string;
  username: string;
  password: string;
}

export interface RoBulkSaved {
  totals: RoBulkTotals;
  created: CreatedRo[];
  credentialsFile: FileDownload;
}

/** The one-time credentials file of the accounts just created. */
async function credentialsFile(created: readonly CreatedRo[], at: Date): Promise<FileDownload> {
  return asDownload(
    [
      {
        name: 'RO login',
        notice: CONFIDENTIAL_NOTICE,
        headers: ['पद', 'RO का नाम', 'मोबाइल', 'यूज़रनेम', 'पासवर्ड'],
        rows: created.map((c) => [c.seatLabel, safe(c.fullName), c.phone, c.username, c.password]),
      },
    ],
    `ro-login-${istStampForFile(at)}.xlsx`,
  );
}

/**
 * "सेव": the DM's password, then ONE transaction that checks the file again on the latest data and
 * creates every NEW row. Error rows block the save unless allowErrors; existing seats/mobiles are
 * always skipped (never overwritten). Anything failing rolls back every account.
 */
export async function saveRoBulk(
  pool: Pool,
  who: Actor,
  body: UploadBody & { password: string; allowErrors: boolean; expectedSeats: readonly string[] },
  vaultKey: Buffer,
): Promise<RoBulkSaved> {
  const file = await readUpload(body, RO_BULK_COLUMNS, [], RO_BULK_MAX_ROWS);
  if (file.rows === null) throw checkFailed(file.errors);
  const sheetRows = file.rows;
  const { totals, created } = await inUserWrite(pool, who, body.password, async (conn) => {
    const { psList, checked } = await checkOn(conn, sheetRows);
    const sum = roBulkTotals(checked);
    if (sum.errors > 0 && !body.allowErrors)
      throw checkFailed(
        checked
          .filter((r) => r.status === 'ERROR')
          .map((r) => ({ rows: [r.rowNumber], message: r.reasons.join('; ') })),
      );
    const seats = newSeats(checked);
    if (seats.join(',') !== [...body.expectedSeats].sort().join(','))
      throw new ApiError(409, 'PREVIEW_STALE');
    if (seats.length === 0) throw new ApiError(409, 'NO_CHANGE');

    const psById = new Map<number, PsRow>(psList.map((ps) => [ps.id, ps]));
    const made: (CreatedRo & { id: number })[] = [];
    for (const row of checked) {
      if (row.status !== 'NEW') continue;
      const seat = row.seat === null ? null : parseSeat(row.seat);
      if (seat === null || row.fullName === null || row.phone === null)
        throw new Error('a NEW row without seat, name or phone');
      const ps = seat.role === 'PS_RO' ? (psById.get(seat.psId) ?? null) : null;
      const account = await createSeatAccountIn(
        conn,
        who,
        { seat, ps, fullName: row.fullName, phone: row.phone },
        vaultKey,
        'web-bulk',
      );
      made.push({
        id: account.id,
        seatLabel: row.seatLabel ?? '',
        fullName: row.fullName,
        phone: row.phone,
        username: account.username,
        password: account.password,
      });
    }
    await writeAudit(conn, {
      userId: who.user.id,
      action: 'RO_BULK_CREATE',
      entity: 'users',
      entityId: null,
      newValue: {
        via: 'web',
        file: safeFileName(body.fileName),
        sha256: file.sha256,
        created: made.length,
        skipped_existing: sum.exists,
        error_rows_left_out: sum.errors,
        user_ids: made.map((m) => m.id),
        usernames: made.map((m) => m.username),
      },
      ip: who.ip,
    });
    return { totals: sum, created: made.map(({ id: _id, ...rest }) => rest) };
  });
  return { totals, created, credentialsFile: await credentialsFile(created, new Date()) };
}

// ---------------------------------------------------------------- RO details download

const DETAIL_HEADERS = ['पद', 'RO का नाम', 'मोबाइल', 'यूज़रनेम', 'स्थिति', 'अंतिम लॉगिन'];
const NO_COPY = 'उपलब्ध नहीं';

const statusText = (a: AccountRow): string =>
  `${a.isActive ? 'चालू' : 'बंद'}${a.lockedNow ? ' · लॉक' : ''}`;

/** Every RO account in page order (PS by Hindi name, then ZP); per seat the active one first. */
async function accountsInOrder(conn: Pool | PoolConnection) {
  const psList = await psInPageOrder(conn);
  const accounts = await loadRoAccounts(conn);
  const bySeat = (list: AccountRow[], label: string) =>
    [...list]
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.id - a.id)
      .map((account) => ({ label, account }));
  return [
    ...psList.flatMap((ps) =>
      bySeat(
        accounts.filter((a) => a.role === 'PS_RO' && a.psId === ps.id),
        psHi(ps.name_hindi),
      ),
    ),
    ...bySeat(
      accounts.filter((a) => a.role === 'ZP_RO'),
      ZP_LABEL,
    ),
  ];
}

const detailRow = ({ label, account: a }: { label: string; account: AccountRow }): Cell[] => [
  label,
  safe(a.fullName),
  a.phone,
  a.username,
  statusText(a),
  a.lastLoginAt === null ? '—' : formatIst(a.lastLoginAt),
];

/** "RO details download" without passwords (GET). Audited (who, when, how many). */
export async function roDetailsFile(
  pool: Pool,
  who: Actor,
): Promise<{ data: Buffer; fileName: string }> {
  const list = await accountsInOrder(pool);
  const data = await writeSheetToBuffer([
    { name: 'RO details', headers: DETAIL_HEADERS, rows: list.map(detailRow) },
  ]);
  await writeAudit(pool, {
    userId: who.user.id,
    action: 'RO_DETAILS_DOWNLOADED',
    entity: 'users',
    entityId: null,
    newValue: { with_passwords: false, accounts: list.length },
    ip: who.ip,
  });
  return { data, fileName: `ro-details-${istStampForFile(new Date())}.xlsx` };
}

/**
 * "पासवर्ड के साथ download": the DM's password first (like creating an RO), then every RO's
 * current password from its encrypted copy ("उपलब्ध नहीं" when there is none). Audit
 * RO_PASSWORDS_EXPORTED (who, which accounts; never a password). The file opens with a warning.
 */
export async function roDetailsWithPasswords(
  pool: Pool,
  who: Actor,
  body: { password: string },
  vaultKey: Buffer,
): Promise<FileDownload> {
  const rows = await inUserWrite(pool, who, body.password, async (conn) => {
    const list = await accountsInOrder(conn);
    const out: Cell[][] = [];
    for (const item of list)
      out.push([
        ...detailRow(item),
        (await currentPassword(conn, item.account.id, vaultKey)) ?? NO_COPY,
      ]);
    await writeAudit(conn, {
      userId: who.user.id,
      action: 'RO_PASSWORDS_EXPORTED',
      entity: 'users',
      entityId: null,
      newValue: {
        via: 'web',
        accounts: list.length,
        usernames: list.map((i) => i.account.username),
      },
      ip: who.ip,
    });
    return out;
  });
  return asDownload(
    [
      {
        name: 'RO details',
        notice: CONFIDENTIAL_NOTICE,
        headers: [...DETAIL_HEADERS, 'पासवर्ड'],
        rows,
      },
    ],
    `ro-details-passwords-${istStampForFile(new Date())}.xlsx`,
  );
}
