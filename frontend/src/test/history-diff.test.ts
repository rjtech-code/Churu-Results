import { describe, expect, it } from 'vitest';
import type { BallotCandidate } from '../api/types';
import { historyDiff } from '../components/historyDiff';

const BALLOT: BallotCandidate[] = [
  { candidateId: 19, ballotPosition: 3, nameHindi: 'नोटा', partyShortName: null, isNota: true },
  { candidateId: 12, ballotPosition: 2, nameHindi: 'बी', partyShortName: null, isNota: false },
  { candidateId: 11, ballotPosition: 1, nameHindi: 'ए', partyShortName: null, isNota: false },
];
const before = {
  round_no: 1,
  sheet_total: 155,
  votes: [
    { candidateId: 11, votes: 100 },
    { candidateId: 12, votes: 50 },
    { candidateId: 19, votes: 5 },
  ],
};
const after = {
  round_no: 1,
  sheet_total: 156,
  votes: [
    { candidateId: 11, votes: 101 },
    { candidateId: 12, votes: 50 },
    { candidateId: 19, votes: 5 },
  ],
};
const changedKeys = (items: { key: string; changed: boolean }[] | null) =>
  (items ?? []).filter((i) => i.changed).map((i) => i.key);

describe('historyDiff', () => {
  it('update: both columns list round, candidates in ballot order (NOTA last), total; only changed values flagged', () => {
    const d = historyDiff('ENTRY_UPDATED', before, after, BALLOT);
    expect(d.before?.map((i) => `${i.label}:${i.value}`)).toEqual([
      'राउंड:1',
      'ए:100',
      'बी:50',
      'नोटा:5',
      'योग:155',
    ]);
    expect(d.after?.map((i) => `${i.label}:${i.value}`)).toEqual([
      'राउंड:1',
      'ए:101',
      'बी:50',
      'नोटा:5',
      'योग:156',
    ]);
    expect(changedKeys(d.before)).toEqual(['c11', 'total']);
    expect(changedKeys(d.after)).toEqual(['c11', 'total']);
    expect(d.voided).toBe(false);
  });

  it('created: no "before", nothing flagged', () => {
    const d = historyDiff('ENTRY_CREATED', null, before, BALLOT);
    expect(d.before).toBeNull();
    expect(changedKeys(d.after)).toEqual([]);
  });

  it('voided: "after" is रद्द (null), the old values are listed without flags', () => {
    const d = historyDiff('ENTRY_VOIDED', after, { voided: true }, BALLOT);
    expect(d.voided).toBe(true);
    expect(d.after).toBeNull();
    expect(changedKeys(d.before)).toEqual([]);
  });

  it('postal: the rejected count is a row and a change to it alone is flagged; round change is flagged', () => {
    const d = historyDiff(
      'POSTAL_UPDATED',
      { sheet_total: 3, rejected_count: 2, votes: before.votes.map((v) => ({ ...v, votes: 1 })) },
      { sheet_total: 3, rejected_count: null, votes: before.votes.map((v) => ({ ...v, votes: 1 })) },
      BALLOT,
    );
    expect(changedKeys(d.after)).toEqual(['rejected']);
    expect(d.after?.find((i) => i.key === 'rejected')?.value).toBe('—');
    const r = historyDiff('ENTRY_UPDATED', before, { ...before, round_no: 2 }, BALLOT);
    expect(changedKeys(r.after)).toEqual(['round']);
  });

  it('a candidate id not on the ballot is still shown (as #id); the correction version is kept', () => {
    const d = historyDiff(
      'ENTRY_UPDATED',
      before,
      { ...after, votes: [...after.votes, { candidateId: 77, votes: 3 }], correction_version: 2 },
      BALLOT,
    );
    expect(d.after?.at(-2)).toMatchObject({ label: '#77', value: '3', changed: true });
    expect(d.correctionVersion).toBe(2);
  });

  it('values that are not entries (garbage) show nothing', () => {
    expect(historyDiff('ENTRY_UPDATED', 'x', 5, BALLOT)).toMatchObject({ before: null, after: null });
  });
});
