import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardBoundary, CardGrid, WardCardView } from '../../screens/WardCardView';
import type { PublicStatus, TopRow, WardCard } from '../../screens/types';

const BJP = { shortName: 'BJP', nameHindi: 'भारतीय जनता पार्टी' };
const top = (
  candidateId: number,
  name: string,
  votes: number,
  rank: number,
  party: typeof BJP | null = null,
): TopRow => ({
  candidateId,
  name,
  party,
  votes,
  rank,
  tiedWithPrevious: false,
});

function card(status: PublicStatus, over: Partial<WardCard> = {}): WardCard {
  return {
    wardId: 1,
    wardNo: 7,
    status,
    boothsEntered: 3,
    boothsTotal: 5,
    latestRound: 2,
    postalEntered: false,
    top3: [top(11, 'सुरेश कुमार', 123456, 1, BJP), top(12, 'महेश चंद', 23456, 2), top(13, 'रमेश', 456, 3)],
    margin: 100000,
    topTied: false,
    notaVotes: 1234,
    winner: null,
    declarationVersion: null,
    isCorrected: false,
    isUnopposed: false,
    reservationCategory: null,
    ...over,
  };
}

const show = (c: WardCard) => render(<WardCardView card={c} changed={false} />).container;
const winnerRows = (root: HTMLElement) => [...root.querySelectorAll('.tv-row-winner')];

describe('ward card', () => {
  it('NOT_STARTED: only "मतगणना शुरू नहीं" — no names, no numbers', () => {
    const root = show(
      card('NOT_STARTED', { top3: [], margin: null, boothsEntered: 0, latestRound: null, notaVotes: 0 }),
    );
    expect(root.textContent).toContain('वार्ड 7');
    expect(root.textContent).toContain('मतगणना शुरू नहीं');
    expect(root.textContent).not.toContain('सुरेश');
    // the only digit on the card is the ward number
    expect(root.textContent.replace('वार्ड 7', '')).not.toMatch(/\d/);
  });

  it('COUNTING with a lead: top 3 with party (or निर्दलीय), en-IN votes, "आगे X मत", small line', () => {
    const root = show(card('COUNTING'));
    expect(screen.getByText('मतगणना जारी')).toBeTruthy();
    const rows = root.querySelectorAll('.tv-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('सुरेश कुमार');
    expect(rows[0]?.textContent).toContain('BJP');
    expect(rows[0]?.textContent).toContain('1,23,456');
    expect(rows[1]?.textContent).toContain('निर्दलीय');
    expect(root.textContent).toContain('आगे 1,00,000 मत');
    expect(root.textContent).toContain('बूथ 3/5 · राउंड 2 · नोटा 1,234');
    expect(winnerRows(root)).toHaveLength(0);
  });

  it('COUNTING with a tie at the top: "बराबर", no lead', () => {
    const root = show(card('COUNTING', { topTied: true, margin: 0 }));
    expect(root.querySelector('.tv-lead')?.textContent).toBe('बराबर');
    expect(root.textContent).not.toContain('आगे');
  });

  it('READY_TO_DECLARE: badge "घोषणा बाकी", still a lead (no winner yet)', () => {
    const root = show(card('READY_TO_DECLARE', { boothsEntered: 5, postalEntered: true }));
    expect(screen.getByText('घोषणा बाकी')).toBeTruthy();
    expect(root.textContent).toContain('आगे 1,00,000 मत');
    expect(root.textContent).toContain('डाक ✓');
    expect(winnerRows(root)).toHaveLength(0);
  });

  it('TIE_NEEDS_LOTTERY: badge and "बराबर"; nobody marked as winner', () => {
    const root = show(card('TIE_NEEDS_LOTTERY', { topTied: true, margin: 0 }));
    expect(screen.getByText('बराबर — लॉटरी बाकी')).toBeTruthy();
    expect(root.querySelector('.tv-lead')?.textContent).toBe('बराबर');
    expect(winnerRows(root)).toHaveLength(0);
  });

  it('DECLARED: the winner row is bold/bordered, starts with "✓" and has no inner badge; "अंतर X मत"', () => {
    const root = show(card('DECLARED', { winner: { candidateId: 11, name: 'सुरेश कुमार', party: BJP } }));
    const rows = winnerRows(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-candidate-id')).toBe('11');
    expect(rows[0]?.querySelector('.tv-name')?.textContent.startsWith('✓ ')).toBe(true);
    expect(within(rows[0] as HTMLElement).queryByText('विजयी')).toBeNull(); // the card badge says it
    expect(rows[0]?.querySelector('.tv-badge, .tv-winner-mark')).toBeNull();
    expect(screen.getAllByText('विजयी')).toHaveLength(1); // only the card badge
    expect(root.textContent).toContain('अंतर 1,00,000 मत');
  });

  it('TIE_RESOLVED: the LOTTERY winner (by candidate id) is marked, even when the tied names are identical', () => {
    const tied = [top(21, 'गोपाल राम', 150, 1), { ...top(22, 'गोपाल राम', 150, 1), tiedWithPrevious: true }];
    const root = show(
      card('TIE_RESOLVED', {
        top3: tied,
        topTied: true,
        margin: 0,
        winner: { candidateId: 22, name: 'गोपाल राम', party: null },
      }),
    );
    expect(screen.getAllByText('विजयी (लॉटरी)')).toHaveLength(1); // the card badge only
    const rows = winnerRows(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-candidate-id')).toBe('22');
    expect(rows[0]?.querySelector('.tv-name')?.textContent.startsWith('✓ ')).toBe(true);
    expect(root.querySelectorAll('.tv-row')[0]?.classList.contains('tv-row-winner')).toBe(false);
    expect(root.querySelectorAll('.tv-row')[0]?.textContent).not.toContain('✓');
    expect(root.textContent).toContain('अंतर 0 मत (लॉटरी से)');
  });

  it('UNOPPOSED: winner with "निर्विरोध निर्वाचित", no vote numbers', () => {
    const root = show(
      card('UNOPPOSED', {
        top3: [],
        margin: null,
        winner: { candidateId: 31, name: 'हरि राम', party: BJP },
        notaVotes: 0,
        boothsEntered: 0,
        latestRound: null,
      }),
    );
    expect(root.textContent).toContain('हरि राम');
    expect(root.textContent).toContain('BJP');
    expect(root.textContent.split('निर्विरोध निर्वाचित')).toHaveLength(2); // shown exactly once (the badge)
    expect(root.querySelector('.tv-unopposed-name')?.textContent).toContain('✓ हरि राम');
    expect(root.textContent.replace('वार्ड 7', '')).not.toMatch(/\d/);
  });

  it('UNAVAILABLE and NO_CANDIDATES: text only, no names or numbers', () => {
    const a = show(card('UNAVAILABLE'));
    expect(a.textContent).toContain('उपलब्ध नहीं');
    expect(a.textContent).not.toContain('सुरेश');
    const b = show(card('NO_CANDIDATES', { top3: [] }));
    expect(b.textContent).toContain('उम्मीदवार सूची बाकी');
    expect(b.textContent.replace('वार्ड 7', '')).not.toMatch(/\d/);
  });

  it('a corrected declaration shows the "संशोधित" badge', () => {
    show(
      card('DECLARED', {
        isCorrected: true,
        declarationVersion: 2,
        winner: { candidateId: 11, name: 'x', party: null },
      }),
    );
    expect(screen.getByText('संशोधित')).toBeTruthy();
  });

  it('a changed card gets the highlight class', () => {
    const { container } = render(<WardCardView card={card('COUNTING')} changed />);
    expect(container.querySelector('.tv-card')?.classList.contains('tv-card-changed')).toBe(true);
  });
});

describe('error boundary per card', () => {
  it('a card that throws shows "उपलब्ध नहीं"; its neighbours still render', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { ...card('COUNTING', { wardId: 2, wardNo: 8 }), top3: null } as unknown as WardCard;
    const { container } = render(
      <CardGrid
        cards={[card('COUNTING'), broken, card('NOT_STARTED', { wardId: 3, wardNo: 9, top3: [] })]}
        changed={new Set()}
        className=""
      />,
    );
    const cards = container.querySelectorAll('.tv-card');
    expect(cards).toHaveLength(3);
    expect(cards[1]?.textContent).toContain('वार्ड 8');
    expect(cards[1]?.textContent).toContain('उपलब्ध नहीं');
    expect(cards[0]?.textContent).toContain('सुरेश कुमार');
    expect(cards[2]?.textContent).toContain('मतगणना शुरू नहीं');
    vi.restoreAllMocks();
  });

  it('recovers when the card data changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Bomb = ({ boom }: { boom: boolean }) => {
      if (boom) throw new Error('x');
      return <p>ठीक</p>;
    };
    const { rerender } = render(
      <CardBoundary wardNo={1} resetKey="a">
        <Bomb boom />
      </CardBoundary>,
    );
    expect(screen.getByText('उपलब्ध नहीं', { selector: 'p' })).toBeTruthy();
    rerender(
      <CardBoundary wardNo={1} resetKey="b">
        <Bomb boom={false} />
      </CardBoundary>,
    );
    expect(screen.getByText('ठीक')).toBeTruthy();
    vi.restoreAllMocks();
  });
});
