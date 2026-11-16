// सारणी-"क" / सारणी-"ख" under the ST Format sections: the ZP table downloads straight away, the PS
// table needs a Panchayat Samiti first (a PS_RO has only its own, so it is chosen for them), and a
// classification value the system could not shorten is named to the officer.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SarniPanel } from '../components/SarniPanel';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
}));

const PS_LIST = {
  ps: [
    { id: 3, nameEnglish: 'SARDARSHAHAR' },
    { id: 4, nameEnglish: 'RAJGARH' },
  ],
};
const summary = (over: Record<string, unknown> = {}) => ({
  wards: 39,
  decided: 30,
  unmappedCategories: [],
  ...over,
});

beforeEach(() => {
  apiMock.mockReset();
});

function show(kind: 'ZP' | 'PS', opts: { list?: typeof PS_LIST; summary?: Record<string, unknown> } = {}) {
  apiMock.mockImplementation((_m: string, path: string) =>
    path === '/api/st-format/ps/list'
      ? Promise.resolve(opts.list ?? PS_LIST)
      : Promise.resolve(summary(opts.summary)),
  );
  render(
    <MemoryRouter>
      <SarniPanel kind={kind} />
    </MemoryRouter>,
  );
}

const link = (name: RegExp) => screen.getByRole('link', { name });

describe('सारणी-"क" (ZP)', () => {
  it('offers the district file and says how much is still pending', async () => {
    show('ZP');
    expect(link(/सारणी-"क"/).getAttribute('href')).toBe('/api/sarni/zp.xlsx');
    const summaryText = await screen.findByTestId('sarni-summary-zp');
    expect(summaryText.textContent).toContain('39 वार्ड');
    expect(summaryText.textContent).toContain('30 निर्वाचित सदस्य');
    expect(summaryText.textContent).toContain('9 वार्ड अभी बाकी');
  });
});

describe('सारणी-"ख" (PS)', () => {
  it('asks for a Panchayat Samiti first, then links to that one', async () => {
    show('PS');
    expect(await screen.findByText('पहले पंचायत समिति चुनें')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), '3');
    await waitFor(() => {
      expect(link(/सारणी-"ख"/).getAttribute('href')).toBe('/api/sarni/ps.xlsx?ps=3');
    });
  });

  it('a PS_RO has one Panchayat Samiti, and it is already chosen', async () => {
    show('PS', { list: { ps: [{ id: 7, nameEnglish: 'CHURU' }] } });
    await waitFor(() => {
      expect(link(/सारणी-"ख"/).getAttribute('href')).toBe('/api/sarni/ps.xlsx?ps=7');
    });
  });

  it('names a classification value it could not shorten', async () => {
    show('PS', {
      list: { ps: [{ id: 7, nameEnglish: 'CHURU' }] },
      summary: { wards: 20, decided: 20, unmappedCategories: ['कुछ और'] },
    });
    const warn = await screen.findByRole('status');
    expect(within(warn).getByText(/कुछ और/)).toBeTruthy();
    expect(warn.textContent).toContain('खाली रहेगा');
  });
});
