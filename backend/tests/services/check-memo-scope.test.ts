// Who may have a check memo of which booths (services/access.ts checkMemoScope). The pure rule, on
// its own: a PS_RO gets their own Panchayat Samiti's booths of a ZP ward and nothing else of it,
// and no role gains or loses anything else.
import { describe, expect, it } from 'vitest';
import { checkMemoScope } from '../../src/services/access.js';
import type { AccessUser, WardScope } from '../../src/services/access.js';

const PS1 = 11;
const PS2 = 22;

const user = (role: AccessUser['role'], psId: number | null = null): AccessUser => ({
  role,
  panchayatSamitiId: psId,
});
const psWard = (psId: number): WardScope => ({ wardType: 'PS', panchayatSamitiId: psId });
const zpWard: WardScope = { wardType: 'ZP', panchayatSamitiId: null };

describe('checkMemoScope', () => {
  it('the DM gets the whole ward, PS or ZP', () => {
    expect(checkMemoScope(user('DM'), psWard(PS1))).toEqual({ kind: 'FULL' });
    expect(checkMemoScope(user('DM'), zpWard)).toEqual({ kind: 'FULL' });
  });

  it('the ZP RO gets the whole ZP ward, and never a PS ward', () => {
    expect(checkMemoScope(user('ZP_RO'), zpWard)).toEqual({ kind: 'FULL' });
    expect(checkMemoScope(user('ZP_RO'), psWard(PS1))).toBeNull();
  });

  it('a PS RO gets their own PS ward whole', () => {
    expect(checkMemoScope(user('PS_RO', PS1), psWard(PS1))).toEqual({ kind: 'FULL' });
  });

  it('a PS RO gets another PS ward not at all', () => {
    expect(checkMemoScope(user('PS_RO', PS1), psWard(PS2))).toBeNull();
  });

  it('a PS RO gets a ZP ward only as their own booths — every ZP ward, the same way', () => {
    expect(checkMemoScope(user('PS_RO', PS1), zpWard)).toEqual({ kind: 'PS', psId: PS1 });
    expect(checkMemoScope(user('PS_RO', PS2), zpWard)).toEqual({ kind: 'PS', psId: PS2 });
  });

  it('a PS RO without a Panchayat Samiti gets nothing', () => {
    expect(checkMemoScope(user('PS_RO', null), zpWard)).toBeNull();
    expect(checkMemoScope(user('PS_RO', null), psWard(PS1))).toBeNull();
  });

  it('the Super Admin and an observer never', () => {
    for (const role of ['SUPER_ADMIN', 'OBSERVER'] as const) {
      expect(checkMemoScope(user(role), psWard(PS1))).toBeNull();
      expect(checkMemoScope(user(role, PS1), zpWard)).toBeNull();
    }
  });
});
