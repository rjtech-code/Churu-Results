// Where the सारणी downloads live: directly under the ST Format panel of the SAME side, on every
// page that shows an ST Format panel. The RO's own ward list ("मेरे वार्ड") is one of those pages —
// it was missed once, and that is exactly what this file guards.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WardListPage } from '../pages/WardListPage';

const apiMock = vi.hoisted(() => vi.fn());
const roleMock = vi.hoisted(() => vi.fn(() => 'ZP_RO'));
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
}));
vi.mock('../auth/AuthContext', () => ({ useRole: () => roleMock() }));

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((_m: string, path: string) => {
    if (path.startsWith('/api/st-format/ps/list')) {
      return Promise.resolve({ ps: [{ id: 4, nameEnglish: 'CHURU' }] });
    }
    if (path.startsWith('/api/st-format')) {
      return Promise.resolve({
        warnings: {
          totalWards: 39,
          declaredWards: 39,
          includedWards: 39,
          unopposedWards: [],
          excludedWards: [],
          missing: { age: [], education: [], mobile: [], category: [] },
          partiesAsInd: [],
          reservationUnknown: [],
          rejectedUnknown: [],
          electorateUnknown: [],
          excludedByWard: [],
          missingByWard: [],
          otherByWard: [],
        },
      });
    }
    if (path.startsWith('/api/sarni')) {
      return Promise.resolve({ wards: 39, decided: 39, unmappedCategories: [] });
    }
    return Promise.resolve({ wards: [] });
  });
});

const show = () =>
  render(
    <MemoryRouter>
      <WardListPage />
    </MemoryRouter>,
  );

/** The order of the two panels on the page (by their test ids). */
const order = (a: string, b: string) => {
  const ids = [...document.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid'));
  return ids.indexOf(a) < ids.indexOf(b);
};

describe('the ward list page', () => {
  it('ZP RO: सारणी-"क" sits under the ZP ST Format panel', async () => {
    roleMock.mockReturnValue('ZP_RO');
    show();
    expect(await screen.findByTestId('section-st-format-zp')).toBeTruthy();
    expect(screen.getByTestId('section-sarni-zp')).toBeTruthy();
    expect(order('section-st-format-zp', 'section-sarni-zp')).toBe(true);
    expect(screen.queryByTestId('section-sarni-ps')).toBeNull();
    expect(await screen.findByRole('link', { name: /सारणी-"क"/ })).toBeTruthy();
  });

  it('PS RO: सारणी-"ख" sits under the PS ST Format panel, for its own Panchayat Samiti', async () => {
    roleMock.mockReturnValue('PS_RO');
    show();
    expect(await screen.findByTestId('section-st-format-ps')).toBeTruthy();
    expect(screen.getByTestId('section-sarni-ps')).toBeTruthy();
    expect(order('section-st-format-ps', 'section-sarni-ps')).toBe(true);
    expect(screen.queryByTestId('section-sarni-zp')).toBeNull();
    // One Panchayat Samiti in the list: it is already chosen, so the button is ready.
    const link = await screen.findByRole('link', { name: /सारणी-"ख"/ });
    expect(link.getAttribute('href')).toBe('/api/sarni/ps.xlsx?ps=4');
  });
});
