import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatIst, istStamp } from '../../scripts/lib/report.js';
import { runUsersList } from '../../scripts/users-list.js';
import { closeHarness, createHarness, makeCtx } from './helpers.js';
import type { Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('report timestamps are IST (Asia/Kolkata)', () => {
  it('formats a UTC instant as IST', () => {
    const utc = new Date('2026-10-06T04:26:11.123Z');
    expect(formatIst(utc)).toBe('2026-10-06 09:56:11 IST');
    expect(istStamp(utc)).toBe('20261006-095611-123');
    // Crossing midnight in IST moves the date forward.
    expect(formatIst(new Date('2026-11-19T19:00:00Z'))).toBe('2026-11-20 00:30:00 IST');
  });

  it('the report header and the report file name show the same IST time', async () => {
    const { ctx } = makeCtx(h);
    const fixed = new Date('2026-11-20T03:15:42.007Z');
    const result = await runUsersList({ ...ctx, now: () => fixed });
    expect(basename(result.reportPath)).toBe('users-list-20261120-084542-007.txt');
    const firstLine = (await readFile(result.reportPath, 'utf8')).split('\n')[0];
    expect(firstLine).toBe('users-list — 2026-11-20 08:45:42 IST');
  });
});
