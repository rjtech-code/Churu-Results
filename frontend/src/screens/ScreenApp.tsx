import type { ReactNode } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { psTitle } from './format';
import { useHideCursor, useLiveFeed, usePager, useStageScale } from './hooks';
import { cardsOf } from './liveFeed';
import type { FeedState } from './liveFeed';
import {
  PS_CARDS_PER_PAGE,
  ZP_CARDS_PER_PAGE,
  pageDuration,
  parseInterval,
  psPages,
  screenProgress,
  zpPages,
} from './paging';
import type { Page } from './paging';
import { PartyNames } from './partyContext';
import { CardGrid } from './WardCardView';
import { LatestWinners, SeatPie, SeatTable } from './ZpWidgets';
import { PageHeader, PagerFooter, SCREEN_NAMES, ScreenHeader, StaleBanner, Ticker } from './ScreenParts';
import type { ScreenBundle, ScreenNo } from './types';
import '../styles/screens.css';

/** The 1920x1080 stage, scaled to the window by CSS (no scrollbars). */
function Stage({ children }: { children: ReactNode }) {
  useStageScale();
  useHideCursor();
  return (
    <div className="tv-viewport">
      <div className="tv-stage">{children}</div>
    </div>
  );
}

/** /screen/:n — public, no login, no dashboard header, no /api/auth. */
export function ScreenApp() {
  const n = useParams().n;
  const screen: ScreenNo | null = n === '1' ? 1 : n === '2' ? 2 : n === '3' ? 3 : null;
  if (screen === null) {
    return (
      <Stage>
        <div className="tv-message">
          <p>यह स्क्रीन मौजूद नहीं है।</p>
          <p className="tv-message-small">/screen/1, /screen/2 या /screen/3 खोलें।</p>
        </div>
      </Stage>
    );
  }
  return <LiveScreen screen={screen} />;
}

/** Every party short name on this screen, so each party has one colour everywhere on it. */
function shortNamesOf(bundle: ScreenBundle): string[] {
  const out = new Set<string>();
  for (const r of [...(bundle.zp?.partySeats ?? []), ...(bundle.zp?.psPartySeats ?? [])]) {
    if (r.party.shortName !== null) out.add(r.party.shortName);
  }
  for (const c of cardsOf(bundle)) {
    for (const t of c.top3) if (t.party) out.add(t.party.shortName);
    if (c.winner?.party) out.add(c.winner.party.shortName);
  }
  for (const w of bundle.winners) if (w.winner.party) out.add(w.winner.party.shortName);
  return [...out];
}

const emptySummary = { wardsTotal: 0, declared: 0, unopposed: 0, counting: 0, notStarted: 0 };

function LiveScreen({ screen }: { screen: ScreenNo }) {
  const feed = useLiveFeed(screen);
  const intervalS = parseInterval(useLocation().search);
  const bundle = feed.bundle;
  const pages: Page[] =
    bundle === null
      ? []
      : screen === 3
        ? zpPages(bundle.zp?.zp.wards ?? [], bundle.zp?.zp.summary ?? emptySummary, ZP_CARDS_PER_PAGE)
        : psPages(
            (bundle.ps?.panchayatSamitis ?? []).map((b) => ({
              ...b,
              panchayatSamiti: { ...b.panchayatSamiti, name: psTitle(b.panchayatSamiti.name) },
            })),
            PS_CARDS_PER_PAGE,
          );
  const index = usePager(pages.map((p) => pageDuration(p, intervalS)));
  const page = pages[index];
  const names = bundle === null ? [] : shortNamesOf(bundle);

  return (
    <PartyNames.Provider value={names}>
      <Stage>
        <ScreenHeader
          name={SCREEN_NAMES[screen]}
          generatedAt={bundle?.generatedAt ?? null}
          live={bundle !== null && !feed.stale}
          progress={bundle === null ? null : screenProgress(cardsOf(bundle))}
        />
        {feed.stale && <StaleBanner generatedAt={bundle?.generatedAt ?? null} />}
        <Ticker items={bundle?.recent ?? []} />
        {bundle === null ? (
          <Waiting feed={feed} />
        ) : page === undefined ? (
          <div className="tv-message">
            <p>इस स्क्रीन पर अभी कोई पंचायत समिति नहीं है।</p>
          </div>
        ) : screen === 3 ? (
          <div className="tv-zp">
            <section className="tv-zp-left">
              <PageHeader page={page} />
              <CardGrid cards={page.wards} changed={feed.changed} className="tv-grid-zp" columns={3} />
            </section>
            <ZpSide bundle={bundle} names={names} />
          </div>
        ) : (
          <section className="tv-ps">
            <PageHeader page={page} />
            <CardGrid cards={page.wards} changed={feed.changed} className="tv-grid-ps" columns={4} />
          </section>
        )}
        {pages.length > 0 && <PagerFooter pages={pages} index={index} />}
      </Stage>
    </PartyNames.Provider>
  );
}

function Waiting({ feed }: { feed: FeedState }) {
  return (
    <div className="tv-message" data-testid="waiting">
      {feed.unavailable ? (
        <>
          <p>परिणाम अभी तैयार हो रहे हैं…</p>
          <p className="tv-message-small">हर 5 सेकंड में फिर कोशिश हो रही है।</p>
        </>
      ) : feed.failed ? (
        <>
          <p>सर्वर से संपर्क नहीं हो पा रहा…</p>
          <p className="tv-message-small">हर 5 सेकंड में फिर कोशिश हो रही है।</p>
        </>
      ) : (
        <p>डेटा लोड हो रहा है…</p>
      )}
    </div>
  );
}

function ZpSide({ bundle, names }: { bundle: ScreenBundle; names: readonly string[] }) {
  const zp = bundle.zp;
  return (
    <aside className="tv-zp-side">
      <section className="tv-panel">
        <h3>ज़िला परिषद — जीती सीटें</h3>
        <SeatPie rows={zp?.partySeats ?? []} allShortNames={names} />
        <SeatTable rows={zp?.partySeats ?? []} allShortNames={names} withTotal testId="zp-seats" />
      </section>
      <section className="tv-panel tv-panel-winners">
        <h3>नवीनतम विजेता</h3>
        <LatestWinners items={bundle.winners} />
      </section>
      <section className="tv-panel">
        <h3>सभी पंचायत समितियाँ</h3>
        <SeatTable rows={zp?.psPartySeats ?? []} allShortNames={names} withTotal={false} testId="ps-seats" />
      </section>
    </aside>
  );
}
