import { Component } from 'react';
import type { ReactNode } from 'react';
import { STATUS_LABEL, STATUS_TONE, fmt, isQuiet, partyShort, wardLabel } from './format';
import { gridRows } from './paging';
import { usePartyColour } from './partyContext';
import type { PartyRef, WardCard } from './types';

const WINNER_STATUSES = new Set(['DECLARED', 'TIE_RESOLVED']);
const LEADING = new Set(['COUNTING', 'READY_TO_DECLARE']);

/** The line under the top 3: lead, margin or tie. */
function leadLine(card: WardCard): string | null {
  switch (card.status) {
    case 'COUNTING':
    case 'READY_TO_DECLARE':
      if (card.topTied) return 'बराबर';
      return card.margin === null ? null : `आगे ${fmt(card.margin)} मत`;
    case 'TIE_NEEDS_LOTTERY':
      return 'बराबर';
    case 'DECLARED':
      return card.margin === null ? null : `अंतर ${fmt(card.margin)} मत`;
    case 'TIE_RESOLVED':
      return `अंतर ${fmt(card.margin ?? 0)} मत (लॉटरी से)`;
    default:
      return null;
  }
}

/** A thin bar in the party colour (an SVG fill: no inline style, allowed by the CSP). */
function PartyBar({ colour }: { colour: string }) {
  return (
    <svg className="tv-party-bar" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
      <rect width="1" height="1" fill={colour} />
    </svg>
  );
}

/**
 * One candidate row, always the same structure:
 *   [party bar] | name (line 1, bold for the winner/leader)  | votes (fixed right column)
 *               | party (line 2, always its own line)        |
 * Names wrap to two lines, then end with "…" — except the winner's, which is never cut.
 */
function Row({
  name,
  party,
  votes,
  winner,
  leader,
  candidateId,
}: {
  name: string;
  party: PartyRef | null;
  votes: number | null;
  winner: boolean;
  leader: boolean;
  candidateId: number;
}) {
  const colourOf = usePartyColour();
  const classes = ['tv-row'];
  if (winner) classes.push('tv-row-winner');
  if (leader) classes.push('tv-row-leader');
  if (votes === null) classes.push('tv-row-novotes');
  return (
    <li className={classes.join(' ')} data-candidate-id={candidateId}>
      <PartyBar colour={colourOf(party?.shortName ?? null)} />
      <span className="tv-row-text">
        <span className="tv-name" data-clamp={winner ? undefined : '2'}>
          {winner && <span className="tv-check">✓ </span>}
          {name}
        </span>
        <span className="tv-party">{partyShort(party)}</span>
      </span>
      {votes !== null && <span className="tv-votes">{fmt(votes)}</span>}
    </li>
  );
}

/** One ward card on a TV screen (what it shows per status: README "TV screens"). */
export function WardCardView({ card, changed }: { card: WardCard; changed: boolean }) {
  const tone = STATUS_TONE[card.status];
  const classes = ['tv-card', `tone-${tone}`, `tv-status-${card.status.toLowerCase().replaceAll('_', '-')}`];
  if (isQuiet(card.status)) classes.push('tv-card-quiet');
  if (changed) classes.push('tv-card-changed');
  const header = (
    <div className="tv-card-head">
      <span className="tv-card-title">{wardLabel(card)}</span>
      <span className="tv-badges">
        {card.isCorrected && <span className="tv-badge tv-badge-corrected">संशोधित</span>}
        <span className="tv-badge tv-badge-status">{STATUS_LABEL[card.status]}</span>
      </span>
    </div>
  );

  let body: ReactNode;
  let foot: ReactNode = null;
  switch (card.status) {
    case 'NOT_STARTED':
      body = <p className="tv-note">मतगणना शुरू नहीं</p>;
      break;
    case 'NO_CANDIDATES':
      body = <p className="tv-note">उम्मीदवार सूची बाकी</p>;
      break;
    case 'UNAVAILABLE':
      body = <p className="tv-note">उपलब्ध नहीं</p>;
      break;
    case 'UNOPPOSED':
      // The badge already says "निर्विरोध निर्वाचित": the body shows only who.
      body =
        card.winner === null ? null : (
          <ol className="tv-top3">
            <Row
              candidateId={card.winner.candidateId}
              name={card.winner.name}
              party={card.winner.party}
              votes={null}
              winner
              leader={false}
            />
          </ol>
        );
      break;
    default: {
      const winnerId = WINNER_STATUSES.has(card.status) ? (card.winner?.candidateId ?? null) : null;
      const lead = leadLine(card);
      body = (
        <ol className="tv-top3">
          {card.top3.map((row, i) => (
            <Row
              key={row.candidateId}
              candidateId={row.candidateId}
              name={row.name}
              party={row.party}
              votes={row.votes}
              winner={row.candidateId === winnerId}
              leader={i === 0 && LEADING.has(card.status) && !card.topTied}
            />
          ))}
        </ol>
      );
      foot = (
        <>
          {lead !== null && <p className="tv-lead">{lead}</p>}
          <p className="tv-small">
            बूथ {card.boothsEntered}/{card.boothsTotal} · राउंड {card.latestRound ?? '—'} · नोटा{' '}
            {fmt(card.notaVotes)}
            {card.postalEntered ? ' · डाक ✓' : ''}
          </p>
        </>
      );
    }
  }
  return (
    <article className={classes.join(' ')} data-ward-id={card.wardId} data-status={card.status}>
      {header}
      <div className="tv-card-body">{body}</div>
      {foot}
    </article>
  );
}

/** A rendering error in one card shows that card as "उपलब्ध नहीं"; the rest of the screen stays. */
export class CardBoundary extends Component<
  { wardNo: number; resetKey: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidUpdate(prev: { resetKey: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <article className="tv-card tone-red tv-status-unavailable" data-status="UNAVAILABLE">
        <div className="tv-card-head">
          <span className="tv-card-title">वार्ड {this.props.wardNo}</span>
          <span className="tv-badge tv-badge-status">उपलब्ध नहीं</span>
        </div>
        <p className="tv-note">उपलब्ध नहीं</p>
      </article>
    );
  }
}

export function CardGrid({
  cards,
  changed,
  className,
  columns = 4,
}: {
  cards: WardCard[];
  changed: ReadonlySet<number>;
  className: string;
  columns?: number;
}) {
  // Rows stretch to the full height (and fonts grow a little with fewer rows): see screens.css.
  return (
    <div className={`tv-grid ${className}`} data-rows={gridRows(cards.length, columns)}>
      {cards.map((c) => (
        <CardBoundary key={c.wardId} wardNo={c.wardNo} resetKey={JSON.stringify(c)}>
          <WardCardView card={c} changed={changed.has(c.wardId)} />
        </CardBoundary>
      ))}
    </div>
  );
}
