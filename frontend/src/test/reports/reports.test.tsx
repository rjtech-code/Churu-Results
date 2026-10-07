import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ReportSummary, ReportWardDetail, ScopeSections } from '../../api/reportTypes';
import { ReportsView } from '../../pages/reports/ReportsHomePage';
import { WardReport } from '../../pages/reports/ReportWardPage';

const ward = (id: number, label: string) => ({ id, kind: 'PS' as const, wardNo: id, psName: 'चूरू', label });

function sections(over: Partial<ScopeSections> = {}): ScopeSections {
  return {
    progress: {
      wardsTotal: 15,
      declared: 4,
      unopposed: 1,
      counting: 6,
      notStarted: 4,
      noCandidates: 0,
      unavailable: 0,
      boothsEntered: 30,
      boothsTotal: 45,
      postalEntered: 5,
      postalTotal: 14,
    },
    partySeats: [{ party: { shortName: 'P1', nameHindi: 'पहला दल' }, won: 3, leading: 2, total: 5 }],
    women: {
      total: 1,
      byParty: [{ party: { shortName: 'P1', nameHindi: 'पहला दल' }, count: 1 }],
      list: [
        {
          ward: ward(3, 'चूरू · वार्ड 3'),
          name: 'सीमा देवी',
          party: { shortName: 'P1', nameHindi: 'पहला दल' },
          status: 'DECLARED',
        },
      ],
    },
    reservation: [{ category: 'महिला', wards: 2, decided: 1, womenWinners: 1 }],
    nota: { notaVotes: 1234, totalValidVotes: 123456, highest: [] },
    close: [
      {
        ward: ward(5, 'चूरू · वार्ड 5'),
        winner: 'मोहन',
        runnerUp: 'सोहन',
        margin: 99,
        marginPercent: 0.8,
        totalValidVotes: 12000,
      },
    ],
    lottery: [],
    corrections: [],
    turnout: { validVotes: 0, registeredVoters: 0, percent: null, wardsIncluded: 0, wardsTotal: 14 },
    ...over,
  };
}

const summary = (over: Partial<ReportSummary> = {}): ReportSummary => ({
  generatedAt: '2026-11-20T14:05:31.000+05:30',
  scopes: [
    { key: 'ALL_PS', label: 'सभी पंचायत समितियाँ' },
    { key: 'PS:1', label: 'चूरू' },
    { key: 'ZP', label: 'ज़िला परिषद' },
  ],
  alarms: [],
  sections: {
    ALL_PS: sections(),
    'PS:1': sections({
      partySeats: [{ party: { shortName: null, nameHindi: 'निर्दलीय' }, won: 1, leading: 0, total: 1 }],
    }),
    ZP: sections({ reservation: null, women: { total: 0, byParty: [], list: [] }, close: [] }),
  },
  ...over,
});

function Harness({ data }: { data: ReportSummary }) {
  const [scope, setScope] = useState('ALL_PS');
  return (
    <MemoryRouter>
      <ReportsView data={data} scope={scope} onScope={setScope} />
    </MemoryRouter>
  );
}

describe('DM reports home', () => {
  it('green "no alarms" line when there are none; a red box listing them when there are', () => {
    const { unmount } = render(<Harness data={summary()} />);
    expect(screen.getByTestId('alarms').textContent).toContain('कोई चेतावनी नहीं');
    unmount();
    render(
      <Harness
        data={summary({
          alarms: [
            {
              kind: 'DECLARATION_MISMATCH',
              ward: ward(8, 'चूरू · वार्ड 8'),
              scope: 'PS:1',
              detail: 'मत बदले',
              at: null,
            },
            {
              kind: 'VOTER_CHECK_DISABLED',
              ward: null,
              scope: null,
              detail: 'जाँच बंद',
              at: '2026-11-20T08:00:00.000+05:30',
            },
          ],
        })}
      />,
    );
    const box = screen.getByTestId('alarms');
    expect(box.getAttribute('role')).toBe('alert');
    expect(box.textContent).toContain('घोषणा और वर्तमान मत मेल नहीं खाते');
    expect(box.textContent).toContain('मतदाता संख्या की जाँच बंद');
    expect(within(box).getByRole('link', { name: 'चूरू · वार्ड 8' }).getAttribute('href')).toBe(
      '/reports/wards/8',
    );
  });

  it('renders every section with en-IN numbers and ward links', () => {
    render(<Harness data={summary()} />);
    for (const id of [
      'progress',
      'party-seats',
      'women',
      'reservation',
      'nota',
      'turnout',
      'close',
      'lottery',
      'corrections',
    ]) {
      expect(screen.getByTestId(`section-${id}`), id).toBeTruthy();
    }
    expect(screen.getByTestId('section-nota').textContent).toContain('1,234');
    expect(screen.getByTestId('section-nota').textContent).toContain('1,23,456');
    expect(screen.getByTestId('section-turnout').textContent).toContain('डेटा उपलब्ध नहीं');
    expect(screen.getByTestId('section-lottery').textContent).toContain('कोई वार्ड लॉटरी से तय नहीं हुआ');
    expect(screen.getByRole('link', { name: 'चूरू · वार्ड 5' }).getAttribute('href')).toBe(
      '/reports/wards/5',
    );
    expect(within(screen.getByTestId('section-women')).getByText('सीमा देवी')).toBeTruthy();
    // CSV links per section, for the chosen scope
    expect(
      within(screen.getByTestId('section-women'))
        .getByRole('link', { name: 'CSV डाउनलोड' })
        .getAttribute('href'),
    ).toBe('/api/reports/export.csv?section=women&scope=ALL_PS');
  });

  it('the filter switches scope (and the CSV links); reservation is hidden when it has no data', async () => {
    render(<Harness data={summary()} />);
    await userEvent.click(screen.getByRole('button', { name: 'चूरू' }));
    expect(screen.getByRole('button', { name: 'चूरू' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('section-party-seats').textContent).toContain('निर्दलीय');
    await userEvent.click(screen.getByRole('button', { name: 'ज़िला परिषद' }));
    expect(screen.queryByTestId('section-reservation')).toBeNull();
    expect(screen.getByTestId('section-women').textContent).toContain('अभी कोई महिला विजेता नहीं');
    expect(
      within(screen.getByTestId('section-close'))
        .getByRole('link', { name: 'CSV डाउनलोड' })
        .getAttribute('href'),
    ).toContain('scope=ZP');
  });

  it('the DM gets no write actions anywhere (only print, filter and CSV)', () => {
    render(<Harness data={summary()} />);
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['प्रिंट करें', 'सभी पंचायत समितियाँ', 'चूरू', 'ज़िला परिषद']);
    for (const word of ['सुधारें', 'घोषणा करें', 'एंट्री करें', 'रद्द करें', 'संशोधन /']) {
      expect(document.body.textContent).not.toContain(word);
    }
  });
});

describe('ward report', () => {
  const detail: ReportWardDetail = {
    ward: {
      id: 7,
      kind: 'PS',
      wardNo: 7,
      psName: 'चूरू',
      reservationCategory: 'महिला',
      isUnopposed: false,
      status: 'TIE_RESOLVED',
      totalValidVotes: 303,
      notaVotes: 3,
      rejectedPostal: 0,
      boothsEntered: 1,
      boothsTotal: 1,
      postalEntered: true,
      margin: 0,
      declarationMismatch: true,
      notaHighest: false,
      unavailable: false,
    },
    candidates: [
      {
        id: 1,
        ballotPosition: 1,
        name: 'गोविंद',
        party: { shortName: 'P1', nameHindi: 'पहला दल' },
        gender: 'M',
        isNota: false,
        boothVotes: 150,
        postalVotes: 0,
        totalVotes: 150,
        rank: 1,
        isWinner: false,
      },
      {
        id: 2,
        ballotPosition: 2,
        name: 'कमला',
        party: null,
        gender: 'F',
        isNota: false,
        boothVotes: 150,
        postalVotes: 0,
        totalVotes: 150,
        rank: 1,
        isWinner: true,
      },
      {
        id: 3,
        ballotPosition: 3,
        name: 'नोटा',
        party: null,
        gender: null,
        isNota: true,
        boothVotes: 3,
        postalVotes: 0,
        totalVotes: 3,
        rank: null,
        isWinner: false,
      },
    ],
    booths: [
      {
        boothId: 11,
        boothNo: 4,
        name: 'बूथ 4',
        psName: 'चूरू',
        registeredVoters: 1000,
        entered: true,
        roundNo: 1,
        sheetTotal: 303,
        votes: [
          { candidateId: 1, votes: 150 },
          { candidateId: 2, votes: 150 },
          { candidateId: 3, votes: 3 },
        ],
        enteredBy: 'RO',
        enteredAt: '2026-11-20T10:00:00.000+05:30',
        updatedBy: null,
        updatedAt: null,
        edits: 1,
        voids: 0,
      },
    ],
    postal: {
      entered: true,
      sheetTotal: 0,
      rejectedCount: 0,
      votes: [],
      enteredBy: 'RO',
      enteredAt: '2026-11-20T10:05:00.000+05:30',
      edits: 0,
      voids: 0,
    },
    declarations: [
      {
        version: 1,
        status: 'TIE_RESOLVED',
        winner: { id: 2, name: 'कमला' },
        margin: 0,
        totalValidVotes: 303,
        lottery: { conductedBy: 'आरओ', note: 'पर्ची निकाली' },
        notaHighestAck: false,
        correctionReason: null,
        declaredBy: 'RO',
        declaredAt: '2026-11-20T11:00:00.000+05:30',
      },
    ],
  };

  it('shows candidates (winner marked), booth-wise votes, versions with lottery, and the ward alarm', () => {
    render(
      <MemoryRouter>
        <WardReport d={detail} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('चूरू · वार्ड 7');
    expect(screen.getByRole('alert').textContent).toContain('घोषणा के बाद मत बदले');
    const cands = screen.getByTestId('ward-candidates');
    expect(within(cands).getByText('✓ कमला')).toBeTruthy();
    expect(within(cands).getByText('महिला')).toBeTruthy();
    expect(within(screen.getByTestId('ward-booths')).getAllByText('150')).toHaveLength(2);
    expect(screen.getByTestId('ward-declarations').textContent).toContain('आरओ: पर्ची निकाली');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['प्रिंट करें']);
  });
});
