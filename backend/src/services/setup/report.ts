import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type RowRef = number | readonly number[];
export type RunMode = 'commit' | 'dry-run' | 'read-only';

function rowLabel(row: RowRef | undefined): string {
  if (row === undefined) return '';
  const rows = typeof row === 'number' ? [row] : [...row].sort((a, b) => a - b);
  if (rows.length === 0) return '';
  return rows.length === 1 ? `[row ${rows[0] ?? ''}] ` : `[rows ${rows.join(', ')}] `;
}

/**
 * Collects everything a script wants to tell the operator. Errors make the run fail (nothing is
 * written). The rendered text is printed and saved under backend/reports/.
 * NEVER put passwords or password hashes into a Report.
 */
export class Report {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];
  private readonly body: string[] = [];

  constructor(
    readonly scriptName: string,
    readonly mode: RunMode,
  ) {}

  /** A method, not a getter: TypeScript would otherwise "narrow" it across report.error() calls. */
  isOk(): boolean {
    return this.errors.length === 0;
  }

  error(message: string, row?: RowRef): void {
    this.errors.push(`${rowLabel(row)}${message}`);
  }

  warn(message: string, row?: RowRef): void {
    this.warnings.push(`${rowLabel(row)}${message}`);
  }

  line(text = ''): void {
    this.body.push(text);
  }

  section(title: string, lines: readonly string[]): void {
    this.body.push('', `== ${title} ==`, ...(lines.length > 0 ? lines : ['(none)']));
  }

  /** `committed` is true only if a transaction was actually committed. */
  render(startedAt: Date, committed: boolean): string {
    const out = [
      `${this.scriptName} — ${formatIst(startedAt)}`,
      `Mode: ${this.mode === 'commit' ? 'COMMIT' : this.mode === 'dry-run' ? 'DRY RUN' : 'READ ONLY'}`,
      ...this.body,
      '',
      `== Errors (${this.errors.length}) ==`,
      ...(this.errors.length > 0 ? this.errors.map((e) => `ERROR   ${e}`) : ['(none)']),
      '',
      `== Warnings (${this.warnings.length}) ==`,
      ...(this.warnings.length > 0 ? this.warnings.map((w) => `WARNING ${w}`) : ['(none)']),
      '',
      `RESULT: ${this.resultLine(committed)}`,
    ];
    return `${out.join('\n')}\n`;
  }

  private resultLine(committed: boolean): string {
    if (!this.isOk()) return `FAILED with ${this.errors.length} error(s). NOTHING was written.`;
    if (this.mode === 'read-only') return 'OK (read only, nothing written).';
    if (this.mode === 'dry-run')
      return 'DRY RUN OK. Nothing was written. Re-run with --commit to write.';
    return committed ? 'COMMITTED.' : 'NOT COMMITTED. Nothing was written.';
  }
}

const IST_OFFSET_MS = 330 * 60_000; // Asia/Kolkata is UTC+05:30 all year (no DST)

/** Human-readable IST time for reports, e.g. "2026-10-06 09:56:11 IST". */
export function formatIst(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS).toISOString();
  return `${ist.slice(0, 10)} ${ist.slice(11, 19)} IST`;
}

/** File-name timestamp in IST, e.g. 20261006-143005-123. */
export function istStamp(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS).toISOString();
  return `${ist.slice(0, 10).replaceAll('-', '')}-${ist.slice(11, 19).replaceAll(':', '')}-${ist.slice(20, 23)}`;
}

/** Writes the report next to earlier ones without ever overwriting a file. */
export async function saveReportText(
  dir: string,
  scriptName: string,
  startedAt: Date,
  text: string,
  extension = 'txt',
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const base = `${scriptName}-${istStamp(startedAt)}`;
  for (let attempt = 1; ; attempt++) {
    const path = join(dir, `${base}${attempt === 1 ? '' : `-${attempt}`}.${extension}`);
    try {
      await writeFile(path, text, { flag: 'wx', mode: 0o640 });
      return path;
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && err.code === 'EEXIST')) throw err;
    }
  }
}
