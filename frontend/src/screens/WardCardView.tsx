import { Component } from 'react';
import type { ReactNode } from 'react';
import { STATUS_LABEL, fmt, partyShort, wardLabel } from './format';
import type { TopRow, WardCard } from './types';

const WINNER_STATUSES = new Set(['DECLARED', 'TIE_RESOLVED']);

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

function Row({ row, winnerMark }: { row: TopRow; winnerMark: string | null }) {
  return (
    <li
      className={winnerMark === null ? 'tv-row' : 'tv-row tv-row-winner'}
      data-candidate-id={row.candidateId}
    >
      <span className="tv-name">
        {row.name} <small className="tv-party">{partyShort(row.party)}</small>
      </span>
      {winnerMark !== null && <span className="tv-winner-mark">{winnerMark}</span>}
      <span className="tv-votes">{fmt(row.votes)}</span>
    </li>
  );
}

/** One ward card on a TV screen (what it shows per status: README "TV screens"). */
export function WardCardView({ card, changed }: { card: WardCard; changed: boolean }) {
  const classes = ['tv-card', `tv-status-${card.status.toLowerCase().replaceAll('_', '-')}`];
  if (changed) classes.push('tv-card-changed');
  const header = (
    <div className="tv-card-head">
      <span className="tv-card-title">{wardLabel(card)}</span>
      <span className="tv-badges">
        {card.isCorrected && <span className="tv-badge tv-badge-corrected">संशोधित</span>}
        <span className="tv-badge">{STATUS_LABEL[card.status]}</span>
      </span>
    </div>
  );

  let body: ReactNode;
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
      body =
        card.winner === null ? (
          <p className="tv-note">निर्विरोध निर्वाचित</p>
        ) : (
          <div className="tv-unopposed">
            <p className="tv-unopposed-name">
              {card.winner.name} <small className="tv-party">{partyShort(card.winner.party)}</small>
            </p>
            <p className="tv-winner-mark">निर्विरोध निर्वाचित</p>
          </div>
        );
      break;
    default: {
      const winnerId = WINNER_STATUSES.has(card.status) ? (card.winner?.candidateId ?? null) : null;
      const mark = card.status === 'TIE_RESOLVED' ? 'विजयी (लॉटरी)' : 'विजयी';
      const lead = leadLine(card);
      body = (
        <>
          <ol className="tv-top3">
            {card.top3.map((row) => (
              <Row key={row.candidateId} row={row} winnerMark={row.candidateId === winnerId ? mark : null} />
            ))}
          </ol>
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
      {body}
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
      <article className="tv-card tv-status-unavailable" data-status="UNAVAILABLE">
        <div className="tv-card-head">
          <span className="tv-card-title">वार्ड {this.props.wardNo}</span>
          <span className="tv-badge">उपलब्ध नहीं</span>
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
}: {
  cards: WardCard[];
  changed: ReadonlySet<number>;
  className: string;
}) {
  return (
    <div className={`tv-grid ${className}`}>
      {cards.map((c) => (
        <CardBoundary key={c.wardId} wardNo={c.wardNo} resetKey={JSON.stringify(c)}>
          <WardCardView card={c} changed={changed.has(c.wardId)} />
        </CardBoundary>
      ))}
    </div>
  );
}
