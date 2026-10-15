import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/api';
import { ERROR_MESSAGES } from '../api/errors';
import {
  IssueList,
  OneTimePassword,
  StepBar,
  fileProblem,
  fileToBase64,
  issuesOf,
} from '../components/AdminParts';
import { Close } from '../pages/reports/Sections';

describe('step bar', () => {
  it('numbers the steps and marks the current one (done steps get ✓)', () => {
    render(<StepBar steps={['फ़ाइल चुनें', 'जाँच', 'पूर्वावलोकन', 'सेव']} current={2} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('.step')?.textContent)).toEqual([
      '✓ फ़ाइल चुनें',
      '✓ जाँच',
      '3 पूर्वावलोकन',
      '4 सेव',
    ]);
    expect(items.map((li) => li.querySelector('.step-arrow')?.textContent ?? '')).toEqual([
      '',
      '→',
      '→',
      '→',
    ]);
    expect(items[2]?.getAttribute('aria-current')).toBe('step');
  });
});

describe('issue list', () => {
  it('shows each Hindi problem; nothing when empty', () => {
    const { container, rerender } = render(<IssueList title="गलतियाँ" issues={[]} />);
    expect(container.textContent).toBe('');
    rerender(
      <IssueList
        title="गलतियाँ"
        issues={[{ rows: [15], message: 'पंक्ति 15: वार्ड 5 में बैलेट नंबर 2 दो बार है' }]}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('गलतियाँ (1)');
    expect(screen.getByRole('alert').textContent).toContain('पंक्ति 15: वार्ड 5 में बैलेट नंबर 2 दो बार है');
  });

  it('reads the problems out of a CHECK_FAILED answer only', () => {
    const issues = [{ rows: [], message: 'x' }];
    expect(issuesOf(new ApiError(400, 'CHECK_FAILED', { errors: issues }))).toEqual(issues);
    expect(issuesOf(new ApiError(401, 'REAUTH_FAILED', {}))).toBeNull();
    expect(issuesOf(new Error('x'))).toBeNull();
  });
});

describe('one-time password box', () => {
  it('shows the password large, says it is shown once, and prints only the box', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const done = vi.fn();
    render(<OneTimePassword username="ro_chu_k7m2" password="Ab7kQm2xHw9tZr4p" onDone={done} />);
    expect(screen.getByTestId('otp-password').textContent).toBe('Ab7k Qm2x Hw9t Zr4p');
    expect(document.body.textContent).toContain('यह पासवर्ड दोबारा नहीं दिखेगा');
    await userEvent.click(screen.getByRole('button', { name: 'प्रिंट करें' }));
    expect(print).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('print-otp')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'हो गया' }));
    expect(done).toHaveBeenCalledOnce();
    // Never kept in browser storage.
    expect(localStorage.length + sessionStorage.length).toBe(0);
    print.mockRestore();
  });
});

describe('file checks in the browser', () => {
  it('only .xlsx up to 5 MB', () => {
    expect(fileProblem(new File(['x'], 'list.csv'))).toContain('.xlsx');
    expect(fileProblem(new File([], 'list.xlsx'))).toContain('खाली');
    expect(fileProblem(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'list.xlsx'))).toContain('5 MB');
    expect(fileProblem(new File(['PK'], 'List.XLSX'))).toBeNull();
  });

  it('base64 of the exact bytes', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
    expect(await fileToBase64(new File([bytes], 'a.xlsx'))).toBe(btoa('PK\x03\x04\xff\x00'));
  });
});

describe('Part 13 error codes have Hindi text', () => {
  it('every new code', () => {
    for (const code of [
      'CHECK_FAILED',
      'MASTER_DATA_BUSY',
      'NOT_XLSX',
      'FILE_TOO_LARGE',
      'BALLOT_LOCKED',
      'COUNTING_STARTED',
      'LOCK_PLAN_CHANGED',
      'LOCK_REFUSED',
      'NOTHING_TO_LOCK',
      'UNLOCK_COUNTING_STARTED',
      'NOTHING_TO_UNLOCK',
      'SEAT_TAKEN',
      'LIST_EMPTY',
      'BOOTH_NAME_INVALID',
      'WARD_NOT_ALLOWED',
      'CATEGORY_TOO_LONG',
    ])
      expect([code, code in ERROR_MESSAGES]).toEqual([code, true]);
  });
});

describe('close contests "अंतर %"', () => {
  it('shows the server text (one formatter for screen and CSV), never a rounded 0%', () => {
    render(
      <MemoryRouter>
        <Close
          rows={[
            {
              ward: { id: 1, label: 'चूरू · वार्ड 5', kind: 'PS', psName: 'चूरू', wardNo: 5 },
              winner: 'मोहन',
              runnerUp: 'सोहन',
              margin: 3,
              marginPercent: 0.03,
              marginPercentText: '0.03%',
              totalValidVotes: 10000,
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(document.body.textContent).toContain('0.03%');
    expect(document.body.textContent).not.toContain('0%3');
  });
});
