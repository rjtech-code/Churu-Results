import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runResultWard } from '../../scripts/result-ward.js';
import {
  closeHarness,
  createHarness,
  makeCtx,
  resetDb,
  seedCandidates,
  seedGeography,
  seedParties,
  wardId,
} from '../scripts/helpers.js';
import type { Harness } from '../scripts/helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await closeHarness(h);
});
beforeEach(async () => {
  await resetDb(h);
  await seedGeography(h);
  await seedParties(h);
  await seedCandidates(h);
});

describe('npm run result:ward', () => {
  it('prints status, booths, every candidate and the flags', async () => {
    const id = await wardId(h, 'PS', 1);
    const { ctx, output } = makeCtx(h);
    const result = await runResultWard({ ward: String(id) }, ctx);
    expect(result.ok).toBe(true);
    const text = output.join('\n');
    expect(text).toContain(`Ward:      PS ward 1 of ALPHA PANCHAYAT SAMITI (ward id ${id})`);
    expect(text).toContain('Status:    NOT_STARTED');
    expect(text).toContain('Booths:    0 of 2 entered');
    expect(text).toContain('Postal:    NOT entered');
    expect(text).toMatch(/1\s+\d+\s+0\s+0\s+0\s+1\s+राम/);
    expect(text).toContain('[NOTA]');
    expect(text).toContain('Flags:     topTied=YES  notaHighest=no  declarationMismatch=no');
    expect(await readFile(result.reportPath, 'utf8')).toContain(
      'RESULT: OK (read only, nothing written).',
    );
  });

  it('shows UNOPPOSED with the winner', async () => {
    const { ctx, output } = makeCtx(h);
    await runResultWard({ ward: String(await wardId(h, 'ZP', 1)) }, ctx);
    expect(output.join('\n')).toMatch(/Status:\s+UNOPPOSED[\s\S]*Winner:\s+\d+/);
  });

  it('an unknown or missing ward id is an error', async () => {
    expect((await runResultWard({ ward: '999999' }, makeCtx(h).ctx)).ok).toBe(false);
    expect((await runResultWard({}, makeCtx(h).ctx)).ok).toBe(false);
    expect((await runResultWard({ ward: 'abc' }, makeCtx(h).ctx)).ok).toBe(false);
  });
});
