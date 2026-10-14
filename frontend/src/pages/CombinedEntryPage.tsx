import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/api';
import { messageFor } from '../api/errors';
import { idParam, loadBooths, loadCombined } from '../api/loaders';
import type { CombinedPreview, CombinedSection } from '../api/types';
import { getLastRound, setLastRound } from '../auth/lastRound';
import { ConfirmPanel } from '../components/ConfirmPanel';
import { ErrorBox, SuccessBox, WarningBox } from '../components/ErrorBox';
import { LeaveGuard } from '../components/LeaveGuard';
import { VoteSheet, checkSheet, sheetValues } from '../components/VoteSheet';
import type { SheetValues } from '../components/VoteSheet';
import { formatDateTime } from '../components/format';
import { useApiData } from '../components/useApiData';
import { rowsOf } from './EntryVoidPage';
import type { WardFlash } from './WardDetailPage';

// Part 14: the PS desk types one booth's parchi (PS votes + ZP votes) on one screen. Both parts are
// saved in ONE server transaction: if either is refused, nothing is saved.

const PART_NAME = { PS: 'पंचायत समिति', ZP: 'जिला परिषद' } as const;
/** idPrefix per part ('entry' for PS: the same field ids/test ids as the single-ballot screen). */
const PREFIX = { PS: 'entry', ZP: 'zp' } as const;

const HIDDEN_TEXT: Record<NonNullable<CombinedSection['hiddenReason']>, string> = {
  UNOPPOSED: 'निर्विरोध वार्ड — मत दर्ज नहीं होंगे',
  NO_CANDIDATES: 'इस वार्ड की उम्मीदवार सूची नहीं है',
  NOT_LOCKED: 'उम्मीदवार सूची अभी लॉक नहीं है — एंट्री नहीं हो सकती',
  DECLARED: 'परिणाम घोषित हो चुका है — अब यहाँ बदलाव नहीं हो सकता',
};

const sectionTitle = (s: CombinedSection) => `${PART_NAME[s.ballotFor]} — वार्ड ${s.wardNo}`;

export function CombinedEntryPage() {
  const boothId = idParam(useParams().boothId);
  const navigate = useNavigate();
  const location = useLocation();
  const flash = ((location.state ?? {}) as WardFlash).flash;
  const { data, error: loadError } = useApiData(async () => {
    const combined = await loadCombined(boothId);
    const ps = combined.sections[0];
    // The PS ward's booth list: for "next booth" after saving (the PS_RO may read its PS wards).
    return { ...combined, psBooths: await loadBooths(ps.wardId) };
  }, [boothId, location.key]);

  const [values, setValues] = useState<{ PS: SheetValues | null; ZP: SheetValues | null }>({
    PS: null,
    ZP: null,
  });
  const [round, setRound] = useState(String(getLastRound()));
  const [stage, setStage] = useState<'form' | 'confirm'>('form');
  const [preview, setPreview] = useState<CombinedPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const allowLeave = useRef(false);

  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  const { booth, sections, psBooths } = data;
  const psSection = sections[0];
  const open = sections.filter((s) => s.state === 'OPEN');
  const sheetOf = (s: CombinedSection) => values[s.ballotFor] ?? sheetValues(s.ballot);
  const dirty = open.some((s) => {
    const sheet = sheetOf(s);
    return Object.values(sheet.votes).some((v) => v !== '') || sheet.total !== '';
  });

  const body = () => {
    const part = (s: CombinedSection) => {
      const check = checkSheet(s.ballot, sheetOf(s));
      return { sheetTotal: check.sheetTotal, votes: check.votes };
    };
    const ps = open.find((s) => s.ballotFor === 'PS');
    const zp = open.find((s) => s.ballotFor === 'ZP');
    return {
      boothId,
      roundNo: Number(round),
      ...(ps ? { ps: part(ps) } : {}),
      ...(zp ? { zp: part(zp) } : {}),
    };
  };

  const onNext = async () => {
    if (busy) return;
    setError(null);
    if (round === '' || Number(round) < 1 || Number(round) > 99) {
      setError('राउंड संख्या 1 से 99 के बीच लिखें');
      return;
    }
    for (const s of open) {
      const check = checkSheet(s.ballot, sheetOf(s));
      if (!check.ok) {
        setError(`${PART_NAME[s.ballotFor]}: ${check.message ?? ''}`);
        return;
      }
    }
    setBusy(true);
    try {
      setPreview(await api<CombinedPreview>('POST', '/api/counting/entries/combined/preview', body()));
      setStage('confirm');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (busy) return; // no double submit
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/counting/entries/combined', body());
      setLastRound(Number(round));
      allowLeave.current = true;
      const next = psBooths.booths.find((b) => !b.entered && b.boothId !== boothId);
      const state: WardFlash = {
        flash: `बूथ ${booth.boothNo} की एंट्री सेव हो गई`,
        highlightBoothId: next?.boothId ?? null,
      };
      void navigate(`/wards/${psSection.wardId}`, { state });
    } catch (err) {
      setError(err);
      setStage('form'); // the error is shown next to "आगे", with every typed number kept
      setBusy(false);
    }
  };

  const failedPart =
    error instanceof ApiError && (error.details.section === 'PS' || error.details.section === 'ZP')
      ? PART_NAME[error.details.section]
      : null;
  const alreadyEntered = error instanceof ApiError && error.code === 'ALREADY_ENTERED';
  const errorView = alreadyEntered ? (
    <>
      {failedPart ? `${failedPart}: ` : ''}यह बूथ पहले ही दर्ज हो चुका है — दोबारा एंट्री नहीं हो सकती।{' '}
      <Link to={`/wards/${psSection.wardId}`}>वार्ड पर वापस जाएँ</Link>
    </>
  ) : failedPart && error instanceof ApiError ? (
    `${failedPart}: ${messageFor(error)}`
  ) : undefined;
  const lastOpen = open[open.length - 1];

  return (
    <>
      <LeaveGuard dirty={dirty} allowRef={allowLeave} />
      <p className="backlink">
        <Link to={`/wards/${psSection.wardId}`}>← वार्ड {psSection.wardNo}</Link>
      </p>
      <SuccessBox text={flash} />
      <div className="sheet-header">
        <div className="big">
          बूथ संख्या {booth.boothNo} — {booth.nameHindi}
        </div>
        <div className="muted small">
          पंजीकृत मतदाता: {booth.registeredVotersTotal ?? 'दर्ज नहीं'} · एक पर्ची: पंचायत समिति + जिला परिषद
        </div>
      </div>

      {stage === 'form' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onNext();
          }}
        >
          {sections.map((s) => (
            <section key={s.ballotFor} className="combined-part" aria-label={sectionTitle(s)}>
              <h2>{sectionTitle(s)}</h2>
              {s.state === 'HIDDEN' && s.hiddenReason !== null && (
                <p className="muted">{HIDDEN_TEXT[s.hiddenReason]}</p>
              )}
              {s.state === 'SAVED' && s.entry && <SavedPart section={s} entry={s.entry} />}
              {s.state === 'OPEN' && (
                <VoteSheet
                  idPrefix={PREFIX[s.ballotFor]}
                  ballot={s.ballot}
                  values={sheetOf(s)}
                  onChange={(v) => {
                    setValues((old) => ({ ...old, [s.ballotFor]: v }));
                    if (typeof error === 'string') setError(null); // a local check message is stale now
                  }}
                  onSubmit={() => {
                    // Enter on this part's total: on to the next part, or "आगे" after the last one.
                    const nextPart = open[open.indexOf(s) + 1];
                    if (nextPart) {
                      const first = [...nextPart.ballot].sort(
                        (a, b) => Number(a.isNota) - Number(b.isNota) || a.ballotPosition - b.ballotPosition,
                      )[0];
                      if (first)
                        document
                          .getElementById(`${PREFIX[nextPart.ballotFor]}-c${first.candidateId}`)
                          ?.focus();
                    } else void onNext();
                  }}
                  round={s === open[0] ? { value: round, onChange: setRound } : undefined}
                  autoFocusFirstCandidate={s === open[0]}
                  error={s === lastOpen ? error : null}
                  errorView={s === lastOpen ? errorView : undefined}
                  actions={
                    s === lastOpen ? (
                      <div className="actions">
                        <button type="submit" className="btn btn-primary btn-big" disabled={busy}>
                          {busy ? 'जाँच हो रही है…' : 'आगे'}
                        </button>
                      </div>
                    ) : undefined
                  }
                />
              )}
            </section>
          ))}
          {open.length === 0 && <p className="msg">इस बूथ पर अभी कोई नई एंट्री बाकी नहीं है।</p>}
        </form>
      )}

      {stage === 'confirm' && preview && (
        <>
          <p className="big">
            पुष्टि करें — बूथ {booth.boothNo}, राउंड {preview.roundNo}
          </p>
          {preview.sections.map((p) => {
            const s = sections.find((x) => x.ballotFor === p.ballotFor);
            return (
              <ConfirmPanel
                key={p.ballotFor}
                title={s ? sectionTitle(s) : PART_NAME[p.ballotFor]}
                rows={p.votes.map((v) => ({
                  key: v.candidateId,
                  label: v.isNota ? 'नोटा' : `${v.ballotPosition}. ${v.nameHindi}`,
                  value: v.votes,
                  isNota: v.isNota,
                }))}
                total={p.sheetTotal}
              />
            );
          })}
          <p className="big">क्या ये संख्याएँ पर्ची से मेल खाती हैं?</p>
          {preview.warnings.includes('VOTER_COUNT_MISSING') && (
            <WarningBox text="इस बूथ की पंजीकृत मतदाता संख्या दर्ज नहीं है, इसलिए वह जाँच नहीं हुई" />
          )}
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary btn-big"
              disabled={busy}
              onClick={() => void onSave()}
            >
              {busy ? 'सेव हो रहा है…' : 'पुष्टि करें और सेव करें'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => {
                setStage('form');
              }}
            >
              वापस जाकर सुधारें
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** A part already saved (by this desk or the ZP RO): its own numbers, and the normal edit/void flow. */
function SavedPart({
  section,
  entry,
}: {
  section: CombinedSection;
  entry: NonNullable<CombinedSection['entry']>;
}) {
  return (
    <>
      <p>
        ✓ दर्ज — राउंड {entry.roundNo} · {formatDateTime(entry.updatedAt ?? entry.enteredAt)}
      </p>
      <ConfirmPanel
        title="दर्ज संख्याएँ"
        rows={rowsOf(section.ballot, entry.votes)}
        total={entry.sheetTotal}
      />
      <div className="actions">
        <Link className="btn btn-secondary" to={`/entries/${entry.id}/edit`}>
          सुधारें
        </Link>
        <Link className="btn btn-secondary" to={`/entries/${entry.id}/void`}>
          रद्द करें
        </Link>
      </div>
    </>
  );
}
