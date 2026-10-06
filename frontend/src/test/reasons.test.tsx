import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { BallotCandidate } from '../api/types';
import {
  OTHER_REASON,
  REASON_MAX,
  ReasonField,
  STANDARD_REASONS,
  detailsMax,
  emptyReason,
  reasonProblem,
  reasonText,
} from '../components/ReasonField';
import type { ReasonValue } from '../components/ReasonField';
import { sameAsSaved } from '../components/VoteSheet';

describe('standard reasons', () => {
  it('offers exactly the five standard reasons', () => {
    expect(STANDARD_REASONS).toEqual([
      'पर्ची पढ़ने में गलती',
      'टाइपिंग में गलती',
      'गलत बूथ चुना गया',
      'पर्ची बाद में संशोधित हुई',
      'अन्य',
    ]);
  });

  it('text sent to the API is "<reason> — <details>", or the reason alone without details', () => {
    expect(reasonText({ choice: 'टाइपिंग में गलती', details: '  बूथ 4 के मत उलटे  ' })).toBe(
      'टाइपिंग में गलती — बूथ 4 के मत उलटे',
    );
    expect(reasonText({ choice: 'टाइपिंग में गलती', details: '   ' })).toBe('टाइपिंग में गलती');
  });

  it('a reason must be chosen; every standard reason alone already meets the 10-character rule', () => {
    expect(reasonProblem(emptyReason)).toContain('कारण चुनें');
    for (const choice of STANDARD_REASONS.filter((r) => r !== OTHER_REASON)) {
      expect(reasonProblem({ choice, details: '' }), choice).toBeNull();
      expect(reasonText({ choice, details: '' }).length).toBeGreaterThanOrEqual(10);
    }
  });

  it('"अन्य" requires details of at least 10 characters', () => {
    expect(reasonProblem({ choice: OTHER_REASON, details: '' })).toContain('विवरण');
    expect(reasonProblem({ choice: OTHER_REASON, details: 'छोटा' })).toContain('विवरण');
    expect(reasonProblem({ choice: OTHER_REASON, details: 'पर्यवेक्षक के निर्देश पर' })).toBeNull();
  });

  it('the whole text never exceeds 500 characters (details limit shrinks by the prefix)', () => {
    const choice = 'पर्ची बाद में संशोधित हुई';
    const max = detailsMax(choice);
    expect(reasonText({ choice, details: 'x'.repeat(max) }).length).toBe(REASON_MAX);
    expect(reasonProblem({ choice, details: 'x'.repeat(max) })).toBeNull();
    expect(reasonProblem({ choice, details: 'x'.repeat(max + 1) })).toContain('500');
  });

  it('the field: dropdown + details box, live length of the final text', async () => {
    function Harness() {
      const [v, setV] = useState<ReasonValue>(emptyReason);
      return (
        <>
          <ReasonField id="r" value={v} onChange={setV} label="सुधार का कारण" />
          <output data-testid="text">{reasonText(v)}</output>
        </>
      );
    }
    render(<Harness />);
    await userEvent.selectOptions(screen.getByLabelText('सुधार का कारण'), OTHER_REASON);
    expect(screen.getByText('विवरण (अनिवार्य, कम से कम 10 अक्षर)')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('विवरण (अनिवार्य, कम से कम 10 अक्षर)'), 'दोबारा गिनती हुई');
    expect(screen.getByTestId('text').textContent).toBe('अन्य — दोबारा गिनती हुई');
  });
});

describe('sameAsSaved (no-change edits)', () => {
  const ballot: BallotCandidate[] = [
    { candidateId: 1, ballotPosition: 1, nameHindi: 'ए', partyShortName: null, isNota: false },
    { candidateId: 9, ballotPosition: 2, nameHindi: 'नोटा', partyShortName: null, isNota: true },
  ];
  const saved = {
    votes: [
      { candidateId: 1, votes: 7 },
      { candidateId: 9, votes: 0 },
    ],
    sheetTotal: 7,
  };
  it('equal numbers (also "007") are no change; any different count or total is a change', () => {
    expect(sameAsSaved(ballot, { votes: { 1: '7', 9: '0' }, total: '7' }, saved)).toBe(true);
    expect(sameAsSaved(ballot, { votes: { 1: '007', 9: '0' }, total: '07' }, saved)).toBe(true);
    expect(sameAsSaved(ballot, { votes: { 1: '6', 9: '1' }, total: '7' }, saved)).toBe(false);
    expect(sameAsSaved(ballot, { votes: { 1: '8', 9: '0' }, total: '8' }, saved)).toBe(false);
    expect(sameAsSaved(ballot, { votes: { 1: '7', 9: '' }, total: '7' }, saved)).toBe(false);
  });
});
