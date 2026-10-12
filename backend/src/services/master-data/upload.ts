// Uploaded Excel files arrive as base64 inside JSON (no multipart library needed). Before exceljs
// ever sees the bytes, they must look like a real, reasonably sized .xlsx: a ZIP whose central
// directory lists the Excel parts, with a bounded number of entries and bounded uncompressed size.
import { createHash } from 'node:crypto';
import { ApiError } from '../../middleware/errors.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Base64 of MAX_UPLOAD_BYTES. */
export const MAX_UPLOAD_BASE64 = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
const MAX_ZIP_ENTRIES = 2000;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
/** Data rows in one sheet (the whole district has ~1,400 candidates). */
export const MAX_SHEET_ROWS = 10_000;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export interface DecodedUpload {
  data: Buffer;
  sha256: string;
}

function notXlsx(): ApiError {
  return new ApiError(400, 'NOT_XLSX');
}

/** Finds the End Of Central Directory record (it sits in the last 22..65,557 bytes). */
function findEocd(data: Buffer): number {
  const stop = Math.max(0, data.length - 22 - 0xffff);
  for (let i = data.length - 22; i >= stop; i--) {
    if (data.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/** Throws NOT_XLSX unless the ZIP structure is a plausible, bounded .xlsx. */
export function assertXlsxStructure(data: Buffer): void {
  if (data.length < 22 || data.readUInt32LE(0) !== LOCAL_SIGNATURE) throw notXlsx();
  const eocd = findEocd(data);
  if (eocd < 0) throw notXlsx();
  const entries = data.readUInt16LE(eocd + 10);
  const cdSize = data.readUInt32LE(eocd + 12);
  const cdOffset = data.readUInt32LE(eocd + 16);
  // 0xFFFF / 0xFFFFFFFF mean ZIP64, which no normal .xlsx of this size needs.
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw notXlsx();
  if (entries === 0 || entries > MAX_ZIP_ENTRIES) throw notXlsx();
  if (cdOffset + cdSize > eocd) throw notXlsx();

  let pos = cdOffset;
  let total = 0;
  const names = new Set<string>();
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > eocd || data.readUInt32LE(pos) !== CENTRAL_SIGNATURE) throw notXlsx();
    const uncompressed = data.readUInt32LE(pos + 24);
    const nameLength = data.readUInt16LE(pos + 28);
    const extraLength = data.readUInt16LE(pos + 30);
    const commentLength = data.readUInt16LE(pos + 32);
    if (uncompressed === 0xffffffff) throw notXlsx();
    total += uncompressed;
    if (total > MAX_UNCOMPRESSED_BYTES) throw notXlsx();
    const nameEnd = pos + 46 + nameLength;
    if (nameEnd > eocd) throw notXlsx();
    names.add(data.toString('utf8', pos + 46, nameEnd));
    pos = nameEnd + extraLength + commentLength;
  }
  if (!names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) throw notXlsx();
}

/** Strict base64 -> bytes; size limit; ZIP/xlsx structure. Throws FILE_TOO_LARGE / NOT_XLSX. */
export function decodeXlsxUpload(base64: string): DecodedUpload {
  if (base64.length > MAX_UPLOAD_BASE64) throw new ApiError(400, 'FILE_TOO_LARGE');
  if (base64.length === 0 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    throw notXlsx();
  const data = Buffer.from(base64, 'base64');
  if (data.length > MAX_UPLOAD_BYTES) throw new ApiError(400, 'FILE_TOO_LARGE');
  assertXlsxStructure(data);
  return { data, sha256: createHash('sha256').update(data).digest('hex') };
}
