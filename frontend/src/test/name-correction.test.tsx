// "नाम सुधारें": after the ballot lock the ward's own RO may correct a candidate's NAME only (reason +
// own password + a "पुराना → नया" confirmation). The button is never shown before the lock, nor to
// any other role; the DM sees the "नाम बदला गया" marker and the history.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NameChange, RoWardDetail } from '../api/adminTypes';
import { ApiError } from '../api/api';
import { messageFor } from '../api/errors';
import { nameFormProblem, normalizeName } from '../components/NameCorrectionDialog';
import { NameChangesPage } from '../pages/admin/NameChangesPage';
import { RoCandidateWardPage } from '../pages/candidates/RoCandidateWardPage';

const apiMock = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ role: 'PS_RO' }));
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
}));
vi.mock('../auth/AuthContext', () => ({ useRole: () => auth.role }));

const DETAILS = {
  dob: null,
  ageStated: null,
  education: null,
  mobile: null,
  candidateCategory: null,
  address: null,
  occupation: null,
};

function ward(locked: boolean, renamed = false): RoWardDetail {
  return {
    ward: {
      id: 7,
      kind: 'PS',
      wardNo: 3,
      label: 'रतनगढ़ पंचायत समिति वार्ड 3',
      panchayatSamiti: 'रतनगढ़ पंचायत समिति',
      status: locked ? 'LOCKED' : 'PENDING',
      unopposed: false,
      hasEntries: false,
      editable: !locked,
      nameCorrectable: locked,
      returnReason: null,
      reservationCategory: null,
    },
    candidates: [
      {
        id: 51,
        ballotPosition: 1,
        nameHindi: 'रमेश कुमर',
        partyId: null,
        gender: 'M',
        nameChanged: renamed,
        ...DETAILS,
      },
      {
        id: 52,
        ballotPosition: 2,
        nameHindi: 'सीता देवी',
        partyId: null,
        gender: 'F',
        nameChanged: false,
        ...DETAILS,
      },
    ],
    parties: [],
  };
}

const CHANGE: NameChange = {
  id: 1,
  wardId: 7,
  wardLabel: 'रतनगढ़ पंचायत समिति वार्ड 3',
  wardKind: 'PS',
  wardNo: 3,
  candidateId: 51,
  ballotPosition: 1,
  oldName: 'रमेश कुमर',
  newName: 'रमेश कुमार',
  reason: 'नामांकन पत्र के अनुसार वर्तनी ठीक की',
  changedByName: 'RO Ratangarh',
  changedByRole: 'PS_RO',
  changedAt: '2026-11-20T05:30:00.000Z',
};

function renderRoPage() {
  const router = createMemoryRouter(
    [
      { path: '/candidates/:wardId', element: <RoCandidateWardPage /> },
      { path: '/not-allowed', element: <p>not allowed</p> },
    ],
    { initialEntries: ['/candidates/7'] },
  );
  render(<RouterProvider router={router} />);
}

// jsdom has no <dialog>.showModal(); a minimal stand-in (the real one is covered by Playwright).
beforeAll(() => {
  for (const [name, open] of [
    ['showModal', true],
    ['close', false],
  ] as const) {
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.toggleAttribute('open', open);
      },
    });
  }
});
beforeEach(() => {
  apiMock.mockReset();
  auth.role = 'PS_RO';
});

const value = (el: HTMLElement) => (el as HTMLInputElement).value;
const disabled = (el: HTMLElement) => (el as HTMLInputElement).disabled;

describe('form rules (same as the server)', () => {
  it('normalizes like the server', () => {
    expect(normalizeName('  राम   कुमार ')).toBe('राम कुमार');
  });
  it('refuses empty, unchanged, short reason, missing password', () => {
    expect(nameFormProblem('राम', '  ', 'कारण दस अक्षर का', 'p')).toBe('नया नाम लिखें');
    expect(nameFormProblem('राम', ' राम ', 'कारण दस अक्षर का', 'p')).toContain('पुराने नाम जैसा');
    expect(nameFormProblem('राम', 'क'.repeat(201), 'कारण दस अक्षर का', 'p')).toContain('200');
    expect(nameFormProblem('राम', 'श्याम', '  छोटा  ', 'p')).toContain('कम से कम 10');
    expect(nameFormProblem('राम', 'श्याम', 'कारण दस अक्षर का', '')).toBe('अपना पासवर्ड लिखें');
    expect(nameFormProblem('राम', 'श्याम', 'कारण दस अक्षर का', 'p')).toBeNull();
  });
  it('every new error code has Hindi text', () => {
    for (const code of [
      'NAME_EMPTY',
      'NAME_TOO_LONG',
      'NAME_INVALID_CHARS',
      'NAME_UNCHANGED',
      'NAME_CHANGED_MEANWHILE',
      'BALLOT_NOT_LOCKED',
    ]) {
      expect(messageFor(new ApiError(409, code, {}))).not.toContain('कुछ गड़बड़');
    }
    expect(messageFor(new ApiError(409, 'NAME_CHANGED_MEANWHILE', { currentName: 'नया' }))).toContain('नया');
  });
});

describe('visibility', () => {
  it('before the lock: no "नाम सुधारें" button (the normal list edit stays)', async () => {
    apiMock.mockResolvedValueOnce(ward(false));
    renderRoPage();
    expect(await screen.findByRole('button', { name: '+ उम्मीदवार जोड़ें' })).toBeTruthy();
    expect(disabled(screen.getByLabelText('पंक्ति 1 नाम'))).toBe(false);
    expect(screen.queryByRole('button', { name: /नाम सुधारें/ })).toBeNull();
  });

  it('after the lock: one button per candidate, every other field disabled', async () => {
    apiMock.mockResolvedValueOnce(ward(true));
    renderRoPage();
    expect(await screen.findByRole('button', { name: 'नाम सुधारें — पंक्ति 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'नाम सुधारें — पंक्ति 2' })).toBeTruthy();
    expect(disabled(screen.getByLabelText('पंक्ति 1 नाम'))).toBe(true);
    expect(disabled(screen.getByLabelText('पंक्ति 1 पार्टी'))).toBe(true);
    expect(screen.queryByRole('button', { name: /हटाएँ/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ उम्मीदवार जोड़ें' })).toBeNull();
  });

  it('a role that may not correct names never sees the button', async () => {
    for (const role of ['DM', 'SUPER_ADMIN']) {
      auth.role = role;
      apiMock.mockResolvedValueOnce(ward(true));
      const { unmount } = render(
        <RouterProvider
          router={createMemoryRouter([{ path: '/candidates/:wardId', element: <RoCandidateWardPage /> }], {
            initialEntries: ['/candidates/7'],
          })}
        />,
      );
      expect(await screen.findByText(/यह सूची लॉक है/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /नाम सुधारें/ })).toBeNull();
      unmount();
    }
  });

  it('a corrected name shows the "नाम बदला गया" marker, which opens the history', async () => {
    apiMock.mockResolvedValueOnce(ward(true, true));
    renderRoPage();
    const mark = await screen.findByRole('button', { name: /नाम बदला गया/ });
    apiMock.mockResolvedValueOnce({ changes: [CHANGE] });
    await userEvent.click(mark);
    const list = await screen.findByTestId('name-history');
    expect(within(list).getByText('रमेश कुमर')).toBeTruthy();
    expect(within(list).getByText('रमेश कुमार')).toBeTruthy();
    expect(within(list).getByText(/वर्तनी ठीक की/)).toBeTruthy();
    expect(apiMock).toHaveBeenLastCalledWith('GET', '/api/candidates/wards/7/name-changes');
  });
});

describe('the dialog', () => {
  async function openDialog() {
    apiMock.mockResolvedValueOnce(ward(true));
    renderRoPage();
    await userEvent.click(await screen.findByRole('button', { name: 'नाम सुधारें — पंक्ति 1' }));
    return screen.getByRole('alertdialog');
  }
  async function fill(d: HTMLElement, name: string, reason: string, password: string) {
    if (name !== '') await userEvent.type(within(d).getByLabelText('नया नाम (हिंदी)'), name);
    if (reason !== '') await userEvent.type(within(d).getByLabelText(/कारण \(अनिवार्य/), reason);
    if (password !== '') await userEvent.type(within(d).getByLabelText(/RO Password/), password);
  }

  it('shows the current name read only; refuses an incomplete form without calling the server', async () => {
    const d = await openDialog();
    const current = within(d).getByLabelText('अभी का नाम');
    expect(value(current)).toBe('रमेश कुमर');
    expect(current.hasAttribute('readonly')).toBe(true);
    await fill(d, 'रमेश कुमार', 'छोटा', 'pass');
    await userEvent.click(within(d).getByRole('button', { name: /आगे/ }));
    expect(within(d).getByRole('alert').textContent).toContain('कम से कम 10');
    expect(apiMock).toHaveBeenCalledTimes(1); // only the page load
  });

  it('confirm step "पुराना → नया", then saves exactly name + reason + password and shows the result', async () => {
    const d = await openDialog();
    await fill(d, '  रमेश   कुमार ', 'नामांकन पत्र के अनुसार वर्तनी ठीक की', 'Secret-RO-1');
    await userEvent.click(within(d).getByRole('button', { name: /आगे/ }));
    const confirm = await screen.findByTestId('name-confirm');
    expect(within(confirm).getByText('रमेश कुमर').classList.contains('name-old')).toBe(true);
    expect(within(confirm).getByText('रमेश कुमार').classList.contains('name-new')).toBe(true);

    apiMock.mockResolvedValueOnce({
      candidateId: 51,
      oldName: 'रमेश कुमर',
      nameHindi: 'रमेश कुमार',
      changedAt: '2026-11-20T05:30:00.000Z',
    });
    const after = ward(true, true);
    const first = after.candidates[0];
    if (first) first.nameHindi = 'रमेश कुमार';
    apiMock.mockResolvedValueOnce(after);
    await userEvent.click(within(confirm).getByRole('button', { name: 'नाम बदलें' }));

    expect(apiMock).toHaveBeenCalledWith('POST', '/api/candidates/wards/7/candidates/51/name', {
      currentName: 'रमेश कुमर',
      newName: 'रमेश कुमार',
      reason: 'नामांकन पत्र के अनुसार वर्तनी ठीक की',
      password: 'Secret-RO-1',
    });
    expect(await screen.findByText(/नाम बदल दिया गया: रमेश कुमर → रमेश कुमार/)).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(value(await screen.findByLabelText('पंक्ति 1 नाम'))).toBe('रमेश कुमार');
  });

  it('"वापस" returns to the form with everything kept', async () => {
    const d = await openDialog();
    await fill(d, 'रमेश कुमार', 'नामांकन पत्र के अनुसार वर्तनी', 'pw');
    await userEvent.click(within(d).getByRole('button', { name: /आगे/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'वापस' }));
    expect(value(screen.getByLabelText('नया नाम (हिंदी)'))).toBe('रमेश कुमार');
  });

  it('a wrong password: clear message, back to the form, password emptied', async () => {
    const d = await openDialog();
    await fill(d, 'रमेश कुमार', 'नामांकन पत्र के अनुसार वर्तनी', 'wrong');
    await userEvent.click(within(d).getByRole('button', { name: /आगे/ }));
    apiMock.mockRejectedValueOnce(new ApiError(401, 'REAUTH_FAILED', {}));
    await userEvent.click(await screen.findByRole('button', { name: 'नाम बदलें' }));
    expect(await screen.findByText(/Incorrect password/)).toBeTruthy();
    expect(value(screen.getByLabelText(/RO Password/))).toBe('');
    expect(value(screen.getByLabelText('नया नाम (हिंदी)'))).toBe('रमेश कुमार');
  });

  it('"रुकें" closes without saving', async () => {
    const d = await openDialog();
    await userEvent.click(within(d).getByRole('button', { name: 'रुकें' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});

describe('DM history page', () => {
  it('lists old -> new, reason, who, when with the ward; CSV button', async () => {
    auth.role = 'DM';
    apiMock.mockResolvedValueOnce({ changes: [CHANGE] });
    render(
      <RouterProvider
        router={createMemoryRouter([{ path: '/', element: <NameChangesPage /> }], {
          initialEntries: ['/'],
        })}
      />,
    );
    const list = await screen.findByTestId('name-history');
    expect(within(list).getByText('रतनगढ़ पंचायत समिति वार्ड 3')).toBeTruthy();
    expect(within(list).getByText(/RO Ratangarh \(PS RO\)/)).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith('GET', '/api/admin/candidate-name-changes');
    expect(disabled(screen.getByRole('button', { name: 'CSV डाउनलोड करें' }))).toBe(false);
  });
});
