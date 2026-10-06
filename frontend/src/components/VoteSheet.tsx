import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { BallotCandidate } from '../api/types';
import { ApiError } from '../api/api';
import { PanelError } from './ErrorBox';
import { NumberField } from './NumberField';
import { SplitLayout } from './SplitLayout';

export interface SheetValues {
  votes: Record<number, string>;
  total: string;
}

export interface SheetCheck {
  ok: boolean;
  message: string | null;
  votes: { candidateId: number; votes: number }[];
  sheetTotal: number;
  sum: number;
}

/** Client-side checks before calling the server: every field typed, and sum = sheet total. */
export function checkSheet(ballot: readonly BallotCandidate[], values: SheetValues): SheetCheck {
  const empty =
    ballot.filter((c) => (values.votes[c.candidateId] ?? '') === '').length + (values.total === '' ? 1 : 0);
  const votes = ballot.map((c) => ({
    candidateId: c.candidateId,
    votes: Number(values.votes[c.candidateId] ?? ''),
  }));
  const sum = votes.reduce((s, v) => s + (Number.isFinite(v.votes) ? v.votes : 0), 0);
  const sheetTotal = Number(values.total);
  if (empty > 0) {
    return {
      ok: false,
      message: `हर खाने में संख्या लिखें — शून्य भी 0 लिखें (${empty} खाने खाली हैं)`,
      votes,
      sheetTotal,
      sum,
    };
  }
  if (sum !== sheetTotal) {
    return {
      ok: false,
      message: `आपका जोड़ ${sum} है, पर पर्ची का योग ${sheetTotal} है — दोनों बराबर होने चाहिए`,
      votes,
      sheetTotal,
      sum,
    };
  }
  return { ok: true, message: null, votes, sheetTotal, sum };
}

interface Props {
  idPrefix: string;
  ballot: readonly BallotCandidate[];
  values: SheetValues;
  onChange: (values: SheetValues) => void;
  /** Enter on the last field ("कुल योग"). */
  onSubmit: () => void;
  /** Optional round field, typed first (Enter moves on to the first candidate). */
  round?: { value: string; onChange: (value: string) => void } | undefined;
  autoFocusFirstCandidate?: boolean;
  /**
   * 'split': candidates on the left; round, total, sum line, extras, error and actions in a sticky
   * panel on the right (one screen). 'stacked' (default): everything in one column.
   */
  layout?: 'split' | 'stacked';
  /** Page-specific fields after the sum line (rejected postal votes, reason). */
  extra?: ReactNode;
  /**
   * The current error, shown next to the actions. A server error (ApiError) also turns the sum line
   * red until the next try; a client message (string) is the page's to clear when numbers change.
   */
  error?: unknown;
  /** Custom text for the error box (e.g. with a link). */
  errorView?: ReactNode;
  /** The buttons ("आगे"). */
  actions?: ReactNode;
}

/**
 * Optional round, one row per candidate in ballot order (NOTA last), the sheet total, and a live
 * line comparing the operator's sum with the sheet's total (colour always with text).
 * Enter moves: round -> candidates -> NOTA -> total -> onSubmit (the same in both layouts).
 */
export function VoteSheet({
  idPrefix,
  ballot,
  values,
  onChange,
  onSubmit,
  round,
  autoFocusFirstCandidate,
  layout = 'stacked',
  extra,
  error,
  errorView,
  actions,
}: Props) {
  const ordered = [...ballot].sort(
    (a, b) => Number(a.isNota) - Number(b.isNota) || a.ballotPosition - b.ballotPosition,
  );
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const offset = round === undefined ? 0 : 1; // index of the first candidate in the Enter order
  const focus = (i: number) => {
    refs.current[i]?.focus();
    refs.current[i]?.select();
  };
  const filled = ordered.filter((c) => (values.votes[c.candidateId] ?? '') !== '');
  const sum = filled.reduce((s, c) => s + Number(values.votes[c.candidateId]), 0);
  const allFilled = filled.length === ordered.length && values.total !== '';
  const hasError = error !== null && error !== undefined;
  // A server refusal (e.g. EXCEEDS_REGISTERED_VOTERS) overrides the local "equal": never green then.
  const serverError = error instanceof ApiError;
  const equal = allFilled && sum === Number(values.total) && !serverError;
  const emptyCount = ordered.length - filled.length + (values.total === '' ? 1 : 0);
  const split = layout === 'split';

  const roundField = round !== undefined && (
    <div className="field-row">
      <label htmlFor={`${idPrefix}-round`}>राउंड संख्या</label>
      <NumberField
        id={`${idPrefix}-round`}
        label="राउंड संख्या"
        className="num-small"
        value={round.value}
        inputRef={(el) => {
          refs.current[0] = el;
        }}
        onChange={round.onChange}
        onEnter={() => {
          focus(offset);
        }}
      />
    </div>
  );
  const totalLabel = <label htmlFor={`${idPrefix}-total`}>कुल योग (पर्ची के अनुसार)</label>;
  const totalField = (
    <NumberField
      id={`${idPrefix}-total`}
      label="कुल योग (पर्ची के अनुसार)"
      value={values.total}
      inputRef={(el) => {
        refs.current[offset + ordered.length] = el;
      }}
      onChange={(v) => {
        onChange({ ...values, total: v });
      }}
      onEnter={onSubmit}
    />
  );
  const sumline = (
    <p className={`sumline ${equal ? 'sum-ok' : 'sum-bad'}`} data-testid={`${idPrefix}-sumline`}>
      आपका जोड़: {sum} | पर्ची का योग: {values.total === '' ? '—' : values.total}{' '}
      {serverError
        ? '✗ रुकावट — नीचे देखें'
        : equal
          ? '✓ बराबर'
          : allFilled
            ? '✗ बराबर नहीं'
            : `(${emptyCount} खाने खाली)`}
    </p>
  );
  const errorBox = <PanelError error={hasError ? error : null}>{errorView}</PanelError>;
  const table = (
    <table className="sheet-table">
      <thead>
        <tr>
          <th>क्रम</th>
          <th>उम्मीदवार</th>
          <th>दल</th>
          <th>मत</th>
        </tr>
      </thead>
      <tbody>
        {ordered.map((c, i) => (
          <tr key={c.candidateId} className={c.isNota ? 'nota-row' : undefined}>
            <td className="pos">{c.isNota ? 'नोटा' : c.ballotPosition}</td>
            <td className="cand">{c.nameHindi}</td>
            <td>{c.isNota ? '—' : (c.partyShortName ?? 'निर्दलीय')}</td>
            <td>
              <NumberField
                id={`${idPrefix}-c${c.candidateId}`}
                label={`${c.nameHindi} के मत`}
                value={values.votes[c.candidateId] ?? ''}
                inputRef={(el) => {
                  refs.current[offset + i] = el;
                }}
                autoFocus={autoFocusFirstCandidate === true && i === 0}
                onChange={(v) => {
                  onChange({ ...values, votes: { ...values.votes, [c.candidateId]: v } });
                }}
                onEnter={() => {
                  focus(offset + i + 1);
                }}
              />
            </td>
          </tr>
        ))}
        {!split && (
          <tr className="total-row">
            <td colSpan={3}>{totalLabel}</td>
            <td>{totalField}</td>
          </tr>
        )}
      </tbody>
    </table>
  );

  if (split) {
    return (
      <SplitLayout
        panelLabel="योग और आगे"
        main={table}
        panel={
          <>
            {roundField}
            <div className="field-row total-field">
              {totalLabel}
              {totalField}
            </div>
            {sumline}
            {extra}
            {errorBox}
            {actions}
          </>
        }
      />
    );
  }
  return (
    <div className="sheet">
      {roundField}
      {table}
      {sumline}
      {extra}
      {errorBox}
      {actions}
    </div>
  );
}

/** Empty sheet values for a ballot, or prefilled from saved votes. */
export function sheetValues(
  ballot: readonly BallotCandidate[],
  saved?: { votes: { candidateId: number; votes: number }[]; sheetTotal: number },
): SheetValues {
  const votes: Record<number, string> = {};
  for (const c of ballot) {
    const v = saved?.votes.find((x) => x.candidateId === c.candidateId);
    votes[c.candidateId] = v === undefined ? '' : String(v.votes);
  }
  return { votes, total: saved === undefined ? '' : String(saved.sheetTotal) };
}

export const NO_CHANGE_TEXT = 'कोई बदलाव नहीं — सुधार की ज़रूरत नहीं';

/** True when every typed count and the sheet total equal the saved entry (as numbers: "007" = 7). */
export function sameAsSaved(
  ballot: readonly BallotCandidate[],
  values: SheetValues,
  saved: { votes: { candidateId: number; votes: number }[]; sheetTotal: number },
): boolean {
  if (values.total === '' || Number(values.total) !== saved.sheetTotal) return false;
  return ballot.every((c) => {
    const typed = values.votes[c.candidateId] ?? '';
    const before = saved.votes.find((v) => v.candidateId === c.candidateId);
    return typed !== '' && Number(typed) === before?.votes;
  });
}
