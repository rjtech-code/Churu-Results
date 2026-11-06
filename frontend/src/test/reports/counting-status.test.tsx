import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CountingStatusOptions,
  CountingStatusView,
  CsKindSummary,
  CsWardRow,
} from '../../api/reportTypes';
import {
  CountingStatusPage,
  EMPTY_SELECTION,
  ScopedReportView,
  scopeQuery,
} from '../../pages/reports/CountingStatusPage';

const mocks = vi.hoisted(() => ({
  api: vi.fn<(method: string, path: string) => Promise<unknown>>(),
  download: vi.fn<(path: string, name: string) => Promise<void>>(),
}));
vi.mock('../../api/api', async (orig) => ({
  ...(await orig<typeof import('../../api/api')>()),
  api: mocks.api,
  downloadFile: mocks.download,
}));

function ward(over: Partial<CsWardRow>): CsWardRow {
  return {
    wardId: 1,
    kind: 'PS',
    psId: 1,
    psName: 'CHURU',
    psNameFull: 'CHURU PANCHAYAT SAMITI',
    wardNo: 1,
    status: 'NOT_STARTED',
    statusLabel: 'Not Started',
    unopposed: false,
    noCandidates: false,
    tieNeedsLottery: false,
    checkData: false,
    stalled: false,
    boothsDone: 0,
    boothsTotal: 4,
    boothsPending: 4,
    boothsPercent: 0,
    latestRound: null,
    postalDone: false,
    lastEntryAt: null,
    lastEntryText: null,
    winner: null,
    margin: null,
    pendingBooths: '1–4',
    ...over,
  };
}
const summary = (over: Partial<CsKindSummary> = {}): CsKindSummary => ({
  wardsTotal: 3,
  notStarted: 1,
  inProgress: 1,
  ready: 0,
  declared: 1,
  unopposed: 0,
  stalled: 1,
  checkData: 0,
  noCandidates: 0,
  boothsDone: 1359,
  boothsTotal: 2000,
  boothsPending: 641,
  boothsPercent: 67.9,
  postalDone: 1,
  postalTotal: 3,
  lastEntryAt: '2026-11-20T10:00:00.000+05:30',
  lastEntryText: '20 Nov 2026, 10:00 AM IST',
  ...over,
});

const DISTRICT: CountingStatusView = {
  title: 'Churu District - Counting Status Report',
  electionName: 'Panchayati Raj General Election 2026 – Zila Parishad & Panchayat Samiti',
  electionDateText: 'Counting date: 20 Nov 2026',
  asOf: '2026-11-20T10:40:00.000+05:30',
  asOfText: '20 Nov 2026, 10:40 AM IST',
  stalledAfterMinutes: 30,
  summary: {
    PS: summary(),
    ZP: summary({ wardsTotal: 1, notStarted: 1, inProgress: 0, declared: 0, stalled: 0 }),
  },
  psTable: [],
  wards: [
    ward({}),
    ward({
      wardId: 2,
      wardNo: 2,
      status: 'IN_PROGRESS',
      statusLabel: 'Counting In Progress',
      stalled: true,
      boothsDone: 1,
      boothsPending: 3,
    }),
    ward({
      wardId: 3,
      wardNo: 3,
      status: 'DECLARED',
      statusLabel: 'Declared',
      boothsDone: 4,
      boothsPending: 0,
      postalDone: true,
      winner: { name: 'Winner Name', party: 'P1' },
      margin: 120,
    }),
  ],
  booths: [],
  kinds: ['PS', 'ZP'],
  scope: {
    level: 'DISTRICT',
    psId: null,
    wardId: null,
    boothId: null,
    status: 'ALL',
    label: 'Whole District',
  },
};
const OPTIONS: CountingStatusOptions = {
  ps: [
    { id: 1, name: 'CHURU' },
    { id: 2, name: 'RAJGARH' },
  ],
  wards: [
    { id: 11, kind: 'PS', psId: 1, wardNo: 1 },
    { id: 12, kind: 'PS', psId: 1, wardNo: 2 },
    { id: 21, kind: 'PS', psId: 2, wardNo: 1 },
    { id: 91, kind: 'ZP', psId: null, wardNo: 1 },
  ],
};

beforeEach(() => {
  mocks.api.mockReset();
  mocks.download.mockReset();
  mocks.api.mockImplementation((_m, path) => {
    if (path === '/api/reports/counting-status/options') return Promise.resolve(OPTIONS);
    if (path.startsWith('/api/reports/counting-status/options/wards/'))
      return Promise.resolve({ booths: [{ id: 501, boothNo: 7, name: 'GOVT SCHOOL' }] });
    return Promise.resolve(DISTRICT);
  });
});

const reportCalls = () =>
  mocks.api.mock.calls.map((c) => c[1]).filter((p) => p.startsWith('/api/reports/counting-status?'));

function showPage() {
  render(
    <MemoryRouter>
      <CountingStatusPage />
    </MemoryRouter>,
  );
}

describe('scopeQuery', () => {
  it('is null until the selection is complete; status only where it applies', () => {
    expect(scopeQuery(EMPTY_SELECTION)).toBeNull();
    expect(scopeQuery({ ...EMPTY_SELECTION, level: 'DISTRICT' })).toBe('level=DISTRICT');
    expect(scopeQuery({ ...EMPTY_SELECTION, level: 'ALL_ZP', status: 'STALLED' })).toBe(
      'level=ALL_ZP&status=STALLED',
    );
    expect(scopeQuery({ ...EMPTY_SELECTION, level: 'PS' })).toBeNull();
    expect(scopeQuery({ ...EMPTY_SELECTION, level: 'PS', psId: '2' })).toBe('level=PS&psId=2');
    expect(scopeQuery({ ...EMPTY_SELECTION, level: 'WARD', wardKind: 'ZP' })).toBeNull();
    expect(scopeQuery({ ...EMPTY_SELECTION, level: 'WARD', wardId: '91', status: 'DECLARED' })).toBe(
      'level=WARD&wardId=91',
    );
    expect(scopeQuery({ ...EMPTY_SELECTION, level: 'BOOTH', psId: '1', wardId: '11' })).toBeNull();
    expect(scopeQuery({ ...EMPTY_SELECTION, level: 'BOOTH', boothId: '501' })).toBe(
      'level=BOOTH&boothId=501',
    );
  });
});

describe('Counting Status Report builder', () => {
  it('starts with only the "Select report" card: no data, nothing loaded, buttons off', async () => {
    showPage();
    expect(await screen.findByRole('heading', { name: 'Select report' })).toBeTruthy();
    expect(screen.queryByTestId('cs-summary-PS')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(reportCalls()).toEqual([]);
    for (const name of ['View Report', 'Download PDF', 'Download CSV'])
      expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true);
  });

  it('View Report loads only the chosen scope; Refresh reloads it; no auto-refresh', async () => {
    showPage();
    await userEvent.selectOptions(await screen.findByLabelText('Level'), 'PS');
    expect(screen.getByRole('button', { name: 'View Report' })).toHaveProperty('disabled', true);
    await userEvent.selectOptions(screen.getByLabelText('Panchayat Samiti'), '2');
    await userEvent.selectOptions(screen.getByLabelText('Status (optional)'), 'STALLED');
    expect(reportCalls()).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'View Report' }));
    expect(await screen.findByTestId('cs-scope')).toBeTruthy();
    expect(reportCalls()).toEqual(['/api/reports/counting-status?level=PS&psId=2&status=STALLED']);
    expect(screen.getByTestId('cs-scope').textContent).toBe(
      'Scope: Whole District · As of 20 Nov 2026, 10:40 AM IST',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(reportCalls()).toHaveLength(2);
    // Changing the selection removes the report (it would no longer match).
    await userEvent.selectOptions(screen.getByLabelText('Level'), 'DISTRICT');
    expect(screen.queryByTestId('cs-scope')).toBeNull();
  });

  it('One Ward: ward type, then PS (or the ZP list), then the ward; no status filter', async () => {
    showPage();
    await userEvent.selectOptions(await screen.findByLabelText('Level'), 'WARD');
    expect(screen.queryByLabelText('Status (optional)')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Ward type'), 'ZP');
    expect(screen.queryByLabelText('Panchayat Samiti')).toBeNull();
    const zp = screen.getByLabelText('Zila Parishad ward');
    expect(
      within(zp)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Select…', 'Ward 1']);
    await userEvent.selectOptions(zp, '91');
    await userEvent.selectOptions(screen.getByLabelText('Ward type'), 'PS');
    await userEvent.selectOptions(screen.getByLabelText('Panchayat Samiti'), '1');
    expect(
      within(screen.getByLabelText('Ward'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Select…', 'Ward 1', 'Ward 2']);
  });

  it('One Booth: PS, its ward, then the booth list of that ward', async () => {
    showPage();
    await userEvent.selectOptions(await screen.findByLabelText('Level'), 'BOOTH');
    await userEvent.selectOptions(screen.getByLabelText('Panchayat Samiti'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Ward'), '11');
    const booth = await screen.findByRole('option', { name: '7 – GOVT SCHOOL' });
    await userEvent.selectOptions(screen.getByLabelText('Booth'), booth);
    await userEvent.click(screen.getByRole('button', { name: 'View Report' }));
    expect(reportCalls()).toEqual(['/api/reports/counting-status?level=BOOTH&boothId=501']);
  });

  it('downloads use the chosen scope, need no View, and run once however fast the clicks', async () => {
    let finish: () => void = () => undefined;
    mocks.download.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    showPage();
    await userEvent.selectOptions(await screen.findByLabelText('Level'), 'ALL_ZP');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Download PDF' }));
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.download).toHaveBeenCalledWith(
      '/api/reports/counting-status.pdf?level=ALL_ZP',
      'counting-status.pdf',
    );
    expect(screen.getByRole('button', { name: 'Download CSV' })).toHaveProperty('disabled', true);
    finish();
    await userEvent.click(await screen.findByRole('button', { name: 'Download CSV' }));
    expect(mocks.download).toHaveBeenLastCalledWith(
      '/api/reports/counting-status/wards.csv?level=ALL_ZP',
      'counting-status-wards.csv',
    );
    expect(reportCalls()).toEqual([]);
  });
});

describe('the report of a scope', () => {
  it('cards, Stalled flag, winner only once declared, all in English', () => {
    render(<ScopedReportView data={DISTRICT} refreshing={false} onRefresh={vi.fn()} onOpenWard={vi.fn()} />);
    const ps = screen.getByTestId('cs-summary-PS');
    expect(within(ps).getByText('1,359')).toBeTruthy();
    expect(within(ps).getByText('641 pending')).toBeTruthy();
    expect(within(ps).getByText('67.9%')).toBeTruthy();
    expect(within(ps).getByText('1 stalled (30+ min)')).toBeTruthy();
    const table = screen.getByTestId('cs-ward-table');
    const row = (id: number): HTMLElement => {
      const r = table.querySelector<HTMLElement>(`tr[data-ward-id="${String(id)}"]`);
      if (r === null) throw new Error(`row ${String(id)}`);
      return r;
    };
    expect(within(row(2)).getByText('Stalled')).toBeTruthy();
    expect(row(2).textContent).not.toContain('Winner Name');
    expect(within(row(3)).getByText('Winner Name (P1)')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[ऀ-ॿ]/u);
  });

  it('a ZP-only scope shows only the Zila Parishad band', () => {
    render(
      <ScopedReportView
        data={{
          ...DISTRICT,
          kinds: ['ZP'],
          scope: { ...DISTRICT.scope, level: 'ALL_ZP', label: 'All Zila Parishad wards' },
        }}
        refreshing={false}
        onRefresh={vi.fn()}
        onOpenWard={vi.fn()}
      />,
    );
    expect(screen.getByTestId('cs-summary-ZP')).toBeTruthy();
    expect(screen.queryByTestId('cs-summary-PS')).toBeNull();
  });

  it('clicking a ward asks for that ward', async () => {
    const open = vi.fn();
    render(<ScopedReportView data={DISTRICT} refreshing={false} onRefresh={vi.fn()} onOpenWard={open} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ward 2' }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ wardId: 2 }));
  });
});
