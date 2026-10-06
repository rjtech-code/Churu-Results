// History pages: the "पहले" and "बाद में" columns as small lists, with every changed value flagged.
import type { BallotCandidate } from '../api/types';

/** An audit row's old/new value of a booth or postal entry (fields as the backend writes them). */
export interface EntryValue {
  ward_id?: number;
  round_no?: number;
  sheet_total?: number;
  rejected_count?: number | null;
  votes?: { candidateId: number; votes: number }[];
  correction_version?: number;
}

export interface DiffItem {
  key: string;
  label: string;
  value: string;
  /** Differs from the same item on the other side (only when both sides exist). */
  changed: boolean;
}

export interface HistoryDiff {
  before: DiffItem[] | null;
  /** null when the entry was voided by this event (shown as "रद्द"). */
  after: DiffItem[] | null;
  voided: boolean;
  correctionVersion: number | null;
}

function asValue(value: unknown): EntryValue | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as EntryValue;
  return v.votes === undefined ? null : v;
}

/** Items of one side: round, each candidate in ballot order (NOTA last; unknown ids after), total, rejected. */
function itemsOf(
  v: EntryValue,
  ballot: readonly BallotCandidate[],
  withRejected: boolean,
): Omit<DiffItem, 'changed'>[] {
  const ordered = [...ballot].sort(
    (a, b) => Number(a.isNota) - Number(b.isNota) || a.ballotPosition - b.ballotPosition,
  );
  const votes = v.votes ?? [];
  const items: Omit<DiffItem, 'changed'>[] = [];
  if (v.round_no !== undefined) items.push({ key: 'round', label: 'राउंड', value: String(v.round_no) });
  for (const c of ordered) {
    const row = votes.find((x) => x.candidateId === c.candidateId);
    if (row !== undefined) {
      items.push({
        key: `c${c.candidateId}`,
        label: c.isNota ? 'नोटा' : c.nameHindi,
        value: String(row.votes),
      });
    }
  }
  for (const row of votes) {
    if (!ordered.some((c) => c.candidateId === row.candidateId)) {
      items.push({ key: `c${row.candidateId}`, label: `#${row.candidateId}`, value: String(row.votes) });
    }
  }
  if (v.sheet_total !== undefined) items.push({ key: 'total', label: 'योग', value: String(v.sheet_total) });
  if (withRejected) {
    items.push({
      key: 'rejected',
      label: 'अस्वीकृत',
      value: v.rejected_count == null ? '—' : String(v.rejected_count),
    });
  }
  return items;
}

export function historyDiff(
  action: string,
  oldValue: unknown,
  newValue: unknown,
  ballot: readonly BallotCandidate[],
): HistoryDiff {
  const voided = action.endsWith('VOIDED');
  const oldV = asValue(oldValue);
  const newV = voided ? null : asValue(newValue);
  const withRejected = [oldV, newV].some((v) => v?.rejected_count !== undefined);
  const oldItems = oldV === null ? null : itemsOf(oldV, ballot, withRejected);
  const newItems = newV === null ? null : itemsOf(newV, ballot, withRejected);
  const mark = (side: Omit<DiffItem, 'changed'>[] | null, other: Omit<DiffItem, 'changed'>[] | null) =>
    side === null
      ? null
      : side.map((item) => {
          const twin = other?.find((o) => o.key === item.key);
          // Only a comparison of two existing sides can show a change (created/voided show none).
          const changed = other !== null && twin?.value !== item.value;
          return { ...item, changed };
        });
  return {
    before: mark(oldItems, newItems),
    after: mark(newItems, oldItems),
    voided,
    correctionVersion: newV?.correction_version ?? null,
  };
}
