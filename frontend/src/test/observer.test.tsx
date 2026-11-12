// Observer dashboard: zero and mid-counting rendering, language toggle, search/filter, and the
// guarantee that no observer page carries an edit control.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  ObserverOverview,
  ObserverWardDetail,
  ObserverWardRow,
  ObserverWinners,
} from '../api/observerTypes';
import { LangContext, translate } from '../pages/observer/i18n';
import type { DictKey, Lang } from '../pages/observer/i18n';
import { AboutPanel } from '../pages/observer/ObserverLayout';
import { OverviewPage } from '../pages/observer/OverviewPage';
import { PsListPage } from '../pages/observer/PsPages';
import { WardPage } from '../pages/observer/WardPage';
import { WinnersPage } from '../pages/observer/WinnersPage';
import { ZpPage } from '../pages/observer/ZpPage';

const mocks = vi.hoisted(() => ({
  api: vi.fn<(method: string, path: string) => Promise<unknown>>(),
}));
vi.mock('../api/api', async (orig) => ({
  ...(await orig<typeof import('../api/api')>()),
  api: mocks.api,
}));

beforeEach(() => {
  mocks.api.mockReset();
  // Reduced motion: numbers render their final value at once (no count-up mid-assertion).
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
  );
});

function wrap(ui: ReactNode, lang: Lang = 'en', path = '/') {
  const state = {
    lang,
    t: (key: DictKey) => translate(lang, key),
    setLang: vi.fn(),
  };
  return render(
    <LangContext.Provider value={state}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={ui} />
          <Route path="/observer/wards/:wardId" element={ui} />
        </Routes>
      </MemoryRouter>
    </LangContext.Provider>,
  );
}

const kpis = (over: Partial<ObserverOverview['kpis']['ps']> = {}) => ({
  wardsTotal: 231,
  declared: 0,
  unopposed: 0,
  counting: 0,
  notStarted: 231,
  boothsEntered: 0,
  boothsTotal: 1359,
  postalEntered: 0,
  postalTotal: 231,
  ...over,
});

const zeroOverview: ObserverOverview = {
  generatedAt: '2026-11-11T10:00:00.000+05:30',
  countingDate: '2026-11-20',
  phase: 'NOT_STARTED',
  structure: {
    panchayatSamitis: 13,
    psWards: 231,
    zpWards: 39,
    booths: 1371,
    candidates: 0,
    parties: 5,
  },
  kpis: { ps: kpis(), zp: kpis({ wardsTotal: 39, boothsTotal: 12, postalTotal: 39, notStarted: 39 }) },
  partySeats: { ps: [], zp: [] },
  feed: [],
};

const midOverview: ObserverOverview = {
  ...zeroOverview,
  phase: 'IN_PROGRESS',
  kpis: {
    ps: kpis({ declared: 40, boothsEntered: 500, counting: 60, notStarted: 131 }),
    zp: kpis({ wardsTotal: 39, declared: 5, boothsEntered: 300, boothsTotal: 1371, postalTotal: 39 }),
  },
  partySeats: {
    ps: [{ party: { shortName: 'P1', nameHindi: 'पहला दल' }, won: 30, leading: 10, total: 40 }],
    zp: [
      { party: { shortName: 'P1', nameHindi: 'पहला दल' }, won: 3, leading: 1, total: 4 },
      { party: { shortName: null, nameHindi: 'निर्दलीय' }, won: 2, leading: 0, total: 2 },
    ],
  },
  feed: [
    {
      wardId: 7,
      kind: 'ZP',
      wardNo: 3,
      psName: null,
      version: 1,
      status: 'DECLARED',
      isCorrection: false,
      winner: { name: 'सरला देवी', party: { shortName: 'P1', nameHindi: 'पहला दल' } },
      margin: 1200,
      declaredAt: '2026-11-20T11:05:00.000+05:30',
    },
  ],
};

const wardRow = (over: Partial<ObserverWardRow>): ObserverWardRow => ({
  wardId: 1,
  kind: 'PS',
  wardNo: 1,
  psName: 'CHURU',
  status: 'NOT_STARTED',
  unopposed: false,
  noCandidates: false,
  tieNeedsLottery: false,
  boothsDone: 0,
  boothsTotal: 4,
  boothsPercent: 0,
  postalDone: false,
  winner: null,
  margin: null,
  ...over,
});

describe('overview', () => {
  it('zero state looks complete: countdown, structure and zeros (never an error)', async () => {
    mocks.api.mockResolvedValue(zeroOverview);
    wrap(<OverviewPage />);
    expect(await screen.findByText('Counting not started')).toBeDefined();
    expect(screen.getByText('Election at a glance')).toBeDefined();
    expect(screen.getByText('Polling booths')).toBeDefined();
    expect(screen.getByText('1,371')).toBeDefined();
    // Before counting day the page leads with the countdown and the structure of the election,
    // and shows the sections ahead — never three empty "nothing yet" panels.
    expect(screen.getByText('Counting begins in')).toBeDefined();
    expect(screen.getByText('What this dashboard will show')).toBeDefined();
    expect(screen.queryByText(/Results will appear here/)).toBeNull();
    expect(screen.queryByText(/Party position/)).toBeNull();
    expect(screen.queryByText(/unavailable/i)).toBeNull();
  });

  it('mid-counting state shows KPIs, party position and the feed', async () => {
    mocks.api.mockResolvedValue(midOverview);
    wrap(<OverviewPage />);
    expect(await screen.findByText('Counting in progress')).toBeDefined();
    expect(screen.getByText('Wards declared')).toBeDefined();
    expect(screen.getByText('800')).toBeDefined(); // 500 + 300 booths counted
    expect(screen.getAllByText('P1').length).toBeGreaterThan(0);
    expect(screen.getByText('Independent')).toBeDefined();
    expect(screen.getByText('सरला देवी')).toBeDefined();
    // The only button on the overview is Print (no edit controls anywhere).
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Print']);
  });

  it('labels follow the Hindi dictionary', async () => {
    mocks.api.mockResolvedValue(midOverview);
    wrap(<OverviewPage />, 'hi');
    expect(await screen.findByText('मतगणना जारी')).toBeDefined();
    expect(screen.getByText('वार्ड घोषित')).toBeDefined();
  });
});

describe('lists and ward detail', () => {
  it('PS list: 13 cards with progress, no buttons or inputs', async () => {
    mocks.api.mockResolvedValue({
      generatedAt: 'x',
      summary: {},
      list: Array.from({ length: 13 }, (_, i) => ({
        psId: i + 1,
        psName: `PS ${String(i + 1)}`,
        wardsTotal: 17,
        declared: i,
        boothsDone: i * 5,
        boothsTotal: 100,
        boothsPercent: i,
        zpBoothsDone: 1,
        zpBoothsTotal: 9,
      })),
    });
    const { container } = wrap(<PsListPage />);
    expect(await screen.findByText('PS 1')).toBeDefined();
    expect(screen.getAllByRole('link').length).toBe(13);
    expect(container.querySelectorAll('button, input, select, textarea, form').length).toBe(0);
  });

  it('ZP list shows status, progress, winner and margin', async () => {
    mocks.api.mockResolvedValue({
      generatedAt: 'x',
      summary: {
        wardsTotal: 39,
        declared: 1,
        boothsDone: 2,
        boothsTotal: 1371,
        postalDone: 0,
        postalTotal: 39,
      },
      wards: [
        wardRow({ wardId: 11, kind: 'ZP', wardNo: 1, psName: null, status: 'IN_PROGRESS', boothsDone: 2, boothsTotal: 40 }),
        wardRow({
          wardId: 12,
          kind: 'ZP',
          wardNo: 2,
          psName: null,
          status: 'DECLARED',
          winner: { name: 'विजेता देवी', party: 'P2' },
          margin: 2500,
          postalDone: true,
        }),
      ],
      byPs: [],
    });
    const { container } = wrap(<ZpPage />);
    expect(await screen.findByText('विजेता देवी')).toBeDefined();
    expect(screen.getByText('2,500')).toBeDefined();
    expect(screen.getByText('In progress')).toBeDefined();
    expect(screen.getByText('Declared')).toBeDefined();
    expect(container.querySelectorAll('button, input, form').length).toBe(0);
  });

  it('ward detail: candidates in ballot order, NOTA, winner, margin, booth chips', async () => {
    const detail: ObserverWardDetail = {
      ward: {
        id: 5,
        kind: 'ZP',
        wardNo: 2,
        psName: null,
        reservationCategory: 'महिला',
        isUnopposed: false,
        status: 'DECLARED',
        totalValidVotes: 160,
        notaVotes: 15,
        rejectedPostal: 2,
        boothsEntered: 2,
        boothsTotal: 3,
        postalEntered: true,
        margin: 55,
        unavailable: false,
      },
      candidates: [
        {
          id: 1,
          ballotPosition: 1,
          name: 'ज़िला उम्मीदवार एक',
          party: { shortName: 'P1', nameHindi: 'पहला दल' },
          isNota: false,
          boothVotes: 90,
          postalVotes: 10,
          totalVotes: 100,
          rank: 1,
          isWinner: true,
        },
        {
          id: 2,
          ballotPosition: 2,
          name: 'ज़िला उम्मीदवार दो',
          party: null,
          isNota: false,
          boothVotes: 45,
          postalVotes: 0,
          totalVotes: 45,
          rank: 2,
          isWinner: false,
        },
        {
          id: 3,
          ballotPosition: 3,
          name: 'नोटा',
          party: null,
          isNota: true,
          boothVotes: 15,
          postalVotes: 0,
          totalVotes: 15,
          rank: null,
          isWinner: false,
        },
      ],
      booths: [
        { boothNo: '12', name: 'बूथ 12', psName: 'CHURU', entered: true },
        { boothNo: '15A', name: 'बूथ 15A', psName: 'RAJGARH', entered: true },
        { boothNo: '16', name: 'बूथ 16', psName: 'RAJGARH', entered: false },
      ],
      postal: { entered: true },
      declarations: [
        {
          version: 1,
          status: 'DECLARED',
          winner: { id: 1, name: 'ज़िला उम्मीदवार एक' },
          margin: 55,
          totalValidVotes: 160,
          declaredAt: '2026-11-20T12:00:00.000+05:30',
        },
      ],
    };
    mocks.api.mockResolvedValue(detail);
    const { container } = wrap(<WardPage />, 'en', '/observer/wards/5');
    expect((await screen.findAllByText('ज़िला उम्मीदवार एक')).length).toBeGreaterThan(0);
    const rows = within(container.querySelector('tbody') as HTMLElement).getAllByRole('row');
    expect(rows.length).toBe(3);
    expect(rows[0]?.className).toContain('obs-winner-row');
    expect(rows[2]?.textContent).toContain('NOTA');
    expect(screen.getAllByText('Winner').length).toBeGreaterThan(0);
    expect(screen.getByText('15A')).toBeDefined();
    expect(container.querySelectorAll('button, input, form').length).toBe(0);
  });
});

describe('about panel credit', () => {
  // The credit names a serving officer: it must read exactly as approved, in both languages,
  // with only the officer's name and Code Churu in bold.
  const EN =
    'An initiative of Shri Abhishek Surana, IAS, District Collector & District Election Officer, Churu. Built by the students of Code Churu, another of his initiatives.';
  const HI =
    'यह श्री अभिषेक सुराणा, आई.ए.एस., जिला कलक्टर एवं जिला निर्वाचन अधिकारी, चूरू की पहल है। इसे उन्हीं की एक अन्य पहल कोड चूरू के विद्यार्थियों ने बनाया है।';

  it.each([
    ['en', EN, ['Shri Abhishek Surana, IAS', 'Code Churu']],
    ['hi', HI, ['श्री अभिषेक सुराणा, आई.ए.एस.', 'कोड चूरू']],
  ] as [Lang, string, string[]][])('reads correctly in %s', (lang, text, bold) => {
    const { container } = wrap(<AboutPanel onClose={vi.fn()} />, lang);
    const credit = container.querySelector('.obs-about-credit');
    expect(credit?.textContent).toBe(text);
    expect([...(credit?.querySelectorAll('strong') ?? [])].map((b) => b.textContent)).toEqual(bold);
    expect(credit?.textContent).not.toContain('Lakshmi');
    expect(credit?.textContent).not.toContain('**');
  });
});

describe('winners search and filters', () => {
  const winners: ObserverWinners = {
    generatedAt: 'x',
    list: [
      {
        wardId: 1,
        kind: 'PS',
        wardNo: 1,
        psName: 'CHURU',
        winner: { name: 'सीमा देवी', party: 'P1' },
        margin: 100,
        unopposed: false,
        tieResolved: false,
        isWoman: true,
        isCorrected: false,
      },
      {
        wardId: 2,
        kind: 'ZP',
        wardNo: 2,
        psName: null,
        winner: { name: 'मोहन लाल', party: 'P2' },
        margin: 50,
        unopposed: false,
        tieResolved: true,
        isWoman: false,
        isCorrected: true,
      },
    ],
  };

  it('filters by text and by women-only', async () => {
    mocks.api.mockResolvedValue(winners);
    wrap(<WinnersPage />);
    expect(await screen.findByText('सीमा देवी')).toBeDefined();
    expect(screen.getByText('मोहन लाल')).toBeDefined();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), 'मोहन');
    expect(screen.queryByText('सीमा देवी')).toBeNull();
    expect(screen.getByText('मोहन लाल')).toBeDefined();
    await user.clear(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByText('सीमा देवी')).toBeDefined();
    expect(screen.queryByText('मोहन लाल')).toBeNull();
  });

  it('marks lottery and corrected results', async () => {
    mocks.api.mockResolvedValue(winners);
    wrap(<WinnersPage />);
    expect(await screen.findByText('By lottery')).toBeDefined();
    expect(screen.getByText('Corrected')).toBeDefined();
  });
});
