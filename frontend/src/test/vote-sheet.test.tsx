import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { BallotCandidate } from '../api/types';
import { ApiError } from '../api/api';
import { ConfirmPanel } from '../components/ConfirmPanel';
import { VoteSheet, checkSheet, sheetValues } from '../components/VoteSheet';
import type { SheetValues } from '../components/VoteSheet';

const BALLOT: BallotCandidate[] = [
  { candidateId: 12, ballotPosition: 2, nameHindi: 'बी', partyShortName: null, isNota: false },
  { candidateId: 19, ballotPosition: 3, nameHindi: 'नोटा', partyShortName: null, isNota: true },
  { candidateId: 11, ballotPosition: 1, nameHindi: 'ए', partyShortName: 'P1', isNota: false },
];

function Harness({ onSubmit = () => undefined }: { onSubmit?: () => void }) {
  const [values, setValues] = useState<SheetValues>(sheetValues(BALLOT));
  const [round, setRound] = useState('1');
  return (
    <VoteSheet
      idPrefix="t"
      ballot={BALLOT}
      values={values}
      onChange={setValues}
      onSubmit={onSubmit}
      round={{ value: round, onChange: setRound }}
    />
  );
}

describe('VoteSheet', () => {
  it('lists candidates in ballot order with NOTA last', () => {
    render(<Harness />);
    const names = screen
      .getAllByRole('row')
      .slice(1, 4)
      .map((r) => r.textContent);
    expect(names[0]).toContain('ए');
    expect(names[1]).toContain('बी');
    expect(names[2]).toContain('नोटा');
  });

  it('live line: red with text while unequal or incomplete, green "बराबर" when equal', async () => {
    render(<Harness />);
    const line = () => screen.getByTestId('t-sumline');
    expect(line().className).toContain('sum-bad');
    expect(line().textContent).toContain('4 खाने खाली');
    await userEvent.type(screen.getByLabelText('ए के मत'), '30');
    await userEvent.type(screen.getByLabelText('बी के मत'), '20');
    await userEvent.type(screen.getByLabelText('नोटा के मत'), '0');
    await userEvent.type(screen.getByLabelText('कुल योग (पर्ची के अनुसार)'), '51');
    expect(line().textContent).toContain('आपका जोड़: 50 | पर्ची का योग: 51');
    expect(line().textContent).toContain('✗ बराबर नहीं');
    expect(line().className).toContain('sum-bad');
    await userEvent.type(screen.getByLabelText('कुल योग (पर्ची के अनुसार)'), '{Backspace}0');
    expect(line().textContent).toContain('✓ बराबर');
    expect(line().className).toContain('sum-ok');
  });

  it('Enter moves round -> candidates -> NOTA -> total; Enter on the total submits', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.click(screen.getByLabelText('राउंड संख्या'));
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByLabelText('ए के मत'));
    await userEvent.keyboard('5{Enter}');
    expect(document.activeElement).toBe(screen.getByLabelText('बी के मत'));
    await userEvent.keyboard('4{Enter}');
    expect(document.activeElement).toBe(screen.getByLabelText('नोटा के मत'));
    await userEvent.keyboard('1{Enter}');
    expect(document.activeElement).toBe(screen.getByLabelText('कुल योग (पर्ची के अनुसार)'));
    await userEvent.keyboard('10{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('checkSheet: empty fields block (empty is not 0); a mismatch blocks with both numbers', () => {
    const empty = checkSheet(BALLOT, { votes: { 11: '5', 12: '', 19: '0' }, total: '5' });
    expect(empty.ok).toBe(false);
    expect(empty.message).toContain('शून्य भी 0 लिखें');
    const mismatch = checkSheet(BALLOT, { votes: { 11: '5', 12: '4', 19: '0' }, total: '10' });
    expect(mismatch).toMatchObject({ ok: false, sum: 9, sheetTotal: 10 });
    expect(mismatch.message).toContain('आपका जोड़ 9');
    expect(mismatch.message).toContain('योग 10');
    const ok = checkSheet(BALLOT, { votes: { 11: '5', 12: '4', 19: '0' }, total: '9' });
    expect(ok).toMatchObject({ ok: true, sum: 9, sheetTotal: 9 });
    expect(ok.votes).toEqual([
      { candidateId: 12, votes: 4 },
      { candidateId: 19, votes: 0 },
      { candidateId: 11, votes: 5 },
    ]);
  });
});

describe('VoteSheet split layout and errors', () => {
  const full: SheetValues = { votes: { 11: '30', 12: '20', 19: '0' }, total: '50' };
  const renderSplit = (error: unknown) =>
    render(
      <VoteSheet
        layout="split"
        idPrefix="s"
        ballot={BALLOT}
        values={full}
        onChange={() => undefined}
        onSubmit={() => undefined}
        error={error}
        actions={<button type="submit">आगे</button>}
      />,
    );

  it('puts the total, sum line, error and "आगे" in the side panel', () => {
    renderSplit('कोई संदेश');
    const panel = screen.getByRole('complementary', { name: 'योग और आगे' });
    expect(panel.contains(screen.getByLabelText('कुल योग (पर्ची के अनुसार)'))).toBe(true);
    expect(panel.contains(screen.getByTestId('s-sumline'))).toBe(true);
    expect(panel.contains(screen.getByRole('alert'))).toBe(true);
    expect(panel.contains(screen.getByRole('button', { name: 'आगे' }))).toBe(true);
    expect(screen.getByRole('alert')).toBe(document.activeElement); // focus moves to the error
  });

  it('a server error keeps the sum line red even when the numbers are equal', () => {
    renderSplit(new ApiError(400, 'EXCEEDS_REGISTERED_VOTERS', { sheetTotal: 50, registeredVoters: 40 }));
    const line = screen.getByTestId('s-sumline');
    expect(line.className).toContain('sum-bad');
    expect(line.className).not.toContain('sum-ok');
    expect(line.textContent).toContain('✗ रुकावट');
    expect(screen.getByRole('alert').textContent).toContain('पंजीकृत मतदाताओं (40) से अधिक');
  });

  it('a local message does not override the live line', () => {
    renderSplit('कारण लिखें');
    expect(screen.getByTestId('s-sumline').textContent).toContain('✓ बराबर');
  });
});

describe('ConfirmPanel', () => {
  it('shows exactly the typed numbers, with before/after for edits', () => {
    render(
      <ConfirmPanel
        title="पुष्टि"
        rows={[
          { key: 1, label: 'ए', value: 30, before: 31 },
          { key: 2, label: 'बी', value: 20, before: 20 },
          { key: 3, label: 'नोटा', value: 0, isNota: true },
        ]}
        total={50}
        totalBefore={51}
      />,
    );
    expect(screen.getAllByTestId('confirm-votes').map((c) => c.textContent)).toEqual(['30', '20', '0']);
    expect(screen.getByTestId('confirm-total').textContent).toBe('50');
    expect(screen.getByText('31')).toBeTruthy();
    expect(screen.getAllByTestId('confirm-votes')[0]?.className).toContain('changed');
    expect(screen.getAllByTestId('confirm-votes')[1]?.className).not.toContain('changed');
  });
});
