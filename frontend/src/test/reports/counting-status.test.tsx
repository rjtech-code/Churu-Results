import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CountingStatusView, CsKindSummary, CsWardRow } from '../../api/reportTypes';
import { CountingStatusReportView } from '../../pages/reports/CountingStatusPage';

const download = vi.hoisted(() => vi.fn<(path: string, name: string) => Promise<void>>());
vi.mock('../../api/api', async (orig) => ({
  ...(await orig<typeof import('../../api/api')>()),
  downloadFile: download,
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

const DATA: CountingStatusView = {
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
    ward({ wardId: 9, kind: 'ZP', psId: null, psName: null, psNameFull: null, wardNo: 1 }),
  ],
};

function show() {
  render(
    <MemoryRouter>
      <CountingStatusReportView data={DATA} />
    </MemoryRouter>,
  );
}

describe('Counting Status Report page', () => {
  it('shows the summary cards and the report time, all in English', () => {
    show();
    const ps = screen.getByTestId('cs-summary-PS');
    expect(within(ps).getByText('1,359')).toBeTruthy();
    expect(within(ps).getByText('/ 2,000')).toBeTruthy();
    expect(within(ps).getByText('641 pending · 67.9%')).toBeTruthy();
    expect(within(ps).getByText('1 stalled (30+ min)')).toBeTruthy();
    expect(screen.getByTestId('cs-report-time').textContent).toBe('Last updated 20 Nov 2026, 10:40 AM IST');
    expect(document.body.textContent).not.toMatch(/[ऀ-ॿ]/u);
  });

  it('wards: status chips, Stalled flag, winner only once declared, PS/ZP filter', async () => {
    show();
    const table = screen.getByTestId('cs-ward-table');
    const row = (no: number) => {
      const r = table.querySelector(`tr[data-ward-id="${String(no)}"]`);
      if (r === null) throw new Error(`row ${String(no)}`);
      return r as HTMLElement;
    };
    expect(within(row(2)).getByText('Stalled')).toBeTruthy();
    expect(within(row(2)).queryByText(/Winner/)).toBeNull();
    expect(row(2).textContent).not.toContain('Winner Name');
    expect(within(row(3)).getByText('Winner Name (P1)')).toBeTruthy();
    expect(screen.getByText('Showing 3 of 3 wards')).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'STALLED');
    expect(screen.getByText('Showing 1 of 3 wards')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Zila Parishad' }));
    expect(screen.getByText('No wards match this filter.')).toBeTruthy();
  });

  it('a download runs once, however fast the clicks', async () => {
    let finish: () => void = () => undefined;
    download.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    show();
    const pdf = screen.getByRole('button', { name: 'PDF download' });
    await userEvent.dblClick(pdf);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith('/api/reports/counting-status.pdf', 'counting-status.pdf');
    expect(screen.getByRole('button', { name: 'Preparing…' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'CSV download (ward-wise)' })).toHaveProperty('disabled', true);
    finish();
    expect(await screen.findByRole('button', { name: 'PDF download' })).toHaveProperty('disabled', false);
  });
});
