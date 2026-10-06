import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runImportParties } from '../../scripts/import-parties.js';
import {
  PARTY_HEADERS,
  auditCount,
  closeHarness,
  count,
  createHarness,
  makeCtx,
  resetDb,
  writeXlsx,
} from './helpers.js';
import type { Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await closeHarness(h);
});
beforeEach(async () => {
  await resetDb(h);
});

const P1 = ['पार्टी एक', 'Party One', 'P1', 'कमल'];
const P2 = ['पार्टी दो', 'Party Two', 'P2', 'हाथ'];
const parties = () => count(h, 'SELECT COUNT(*) AS n FROM party');

describe('import:parties', () => {
  it('imports parties', async () => {
    const file = await writeXlsx(h, PARTY_HEADERS, [P1, P2]);
    const result = await runImportParties({ file, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(true);
    expect(await parties()).toBe(2);
    expect(await auditCount(h)).toBe(1);
  });

  it('a duplicate short_name fails and writes nothing', async () => {
    const file = await writeXlsx(h, PARTY_HEADERS, [P1, ['अन्य', 'Other', 'p1', 'तारा']]);
    const result = await runImportParties({ file, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(false);
    expect(await readFile(result.reportPath, 'utf8')).toContain(
      '[rows 2, 3] short_name "P1" appears more than once',
    );
    expect(await parties()).toBe(0);
    expect(await auditCount(h)).toBe(0);
  });

  it('re-importing identical parties is fine; changing one is refused', async () => {
    await runImportParties(
      { file: await writeXlsx(h, PARTY_HEADERS, [P1]), commit: true },
      makeCtx(h).ctx,
    );
    const again = await runImportParties(
      { file: await writeXlsx(h, PARTY_HEADERS, [P1, P2]), commit: true },
      makeCtx(h).ctx,
    );
    expect(again.ok).toBe(true);
    expect(await parties()).toBe(2);
    const changed = await runImportParties(
      {
        file: await writeXlsx(h, PARTY_HEADERS, [['पार्टी एक', 'Party One', 'P1', 'सूरज']]),
        commit: true,
      },
      makeCtx(h).ctx,
    );
    expect(changed.ok).toBe(false);
    expect(await readFile(changed.reportPath, 'utf8')).toContain(
      'already exists with different symbol',
    );
  });

  it('empty required cells fail', async () => {
    const file = await writeXlsx(h, PARTY_HEADERS, [['पार्टी', 'Party', null, 'कमल']]);
    const result = await runImportParties({ file }, makeCtx(h).ctx);
    expect(result.ok).toBe(false);
    expect(await readFile(result.reportPath, 'utf8')).toContain('[row 2] "short_name" is empty');
  });
});
