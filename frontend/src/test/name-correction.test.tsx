// "विवरण सुधारें": after the ballot lock the ward's own RO may correct every candidate DETAIL (name,
// party, gender, category, dob/age, education, mobile, address, occupation) with a reason, its own
// password and a confirmation that lists only what changed. The ballot order, adding / removing a
// candidate and NOTA are not offered at all. The button is never shown before the lock, nor to any
// other role; the DM sees the "विवरण बदला गया" marker and the history with the field name.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NameChange, RoWardDetail } from '../api/adminTypes';
import { ApiError } from '../api/api';
import { messageFor } from '../api/errors';
import {
  changedFields,
  nameFormProblem,
  normalizeName,
  valueText,
} from '../components/NameCorrectionDialog';
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
    parties: [
      { id: 1, shortName: 'BJP', nameHindi: 'भारतीय जनता पार्टी' },
      { id: 2, shortName: 'INC', nameHindi: 'भारतीय राष्ट्रीय कांग्रेस' },
    ],
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
  field: 'NAME',
  fieldLabel: 'नाम',
  oldValue: 'रमेश कुमर',
  newValue: 'रमेश कुमार',
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
      'FIELD_FROZEN',
      'GENDER_INVALID',
      'CANDIDATE_CATEGORY_INVALID',
      'DOB_INVALID',
      'AGE_INVALID',
      'EDUCATION_INVALID',
      'MOBILE_INVALID',
      'ADDRESS_TOO_LONG',
      'OCCUPATION_TOO_LONG',
      'PARTY_UNKNOWN',
      'PARTY_TAKEN',
      'PARTY_CONFIRM_REQUIRED',
      'NO_CHANGE',
    ]) {
      expect(messageFor(new ApiError(409, code, {}))).not.toContain('कुछ गड़बड़');
    }
    expect(messageFor(new ApiError(409, 'NAME_CHANGED_MEANWHILE', { currentName: 'नया' }))).toContain('नया');
    expect(messageFor(new ApiError(400, 'FIELD_FROZEN', { field: 'मतपत्र क्रम' }))).toContain('मतपत्र क्रम');
  });
});

describe('visibility', () => {
  it('before the lock: no "विवरण सुधारें" button (the normal list edit stays)', async () => {
    apiMock.mockResolvedValueOnce(ward(false));
    renderRoPage();
    expect(await screen.findByRole('button', { name: '+ उम्मीदवार जोड़ें' })).toBeTruthy();
    expect(disabled(screen.getByLabelText('पंक्ति 1 नाम'))).toBe(false);
    expect(screen.queryByRole('button', { name: /विवरण सुधारें/ })).toBeNull();
  });

  it('after the lock: one button per candidate, every other field disabled', async () => {
    apiMock.mockResolvedValueOnce(ward(true));
    renderRoPage();
    expect(await screen.findByRole('button', { name: 'विवरण सुधारें — पंक्ति 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'विवरण सुधारें — पंक्ति 2' })).toBeTruthy();
    expect(disabled(screen.getByLabelText('पंक्ति 1 नाम'))).toBe(true);
    expect(disabled(screen.getByLabelText('पंक्ति 1 पार्टी'))).toBe(true);
    expect(screen.queryByRole('button', { name: /हटाएँ/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ उम्मीदवार जोड़ें' })).toBeNull();
  });

  it('a role that may not correct details never sees the button', async () => {
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
      expect(screen.queryByRole('button', { name: /विवरण सुधारें/ })).toBeNull();
      unmount();
    }
  });

  it('a corrected candidate shows the "विवरण बदला गया" marker, which opens the history', async () => {
    apiMock.mockResolvedValueOnce(ward(true, true));
    renderRoPage();
    const mark = await screen.findByRole('button', { name: /विवरण बदला गया/ });
    apiMock.mockResolvedValueOnce({ changes: [CHANGE] });
    await userEvent.click(mark);
    const list = await screen.findByTestId('name-history');
    expect(within(list).getByText('रमेश कुमर')).toBeTruthy();
    expect(within(list).getByText('रमेश कुमार')).toBeTruthy();
    expect(within(list).getByText(/वर्तनी ठीक की/)).toBeTruthy();
    expect(within(list).getByText('नाम')).toBeTruthy(); // which field changed
    expect(apiMock).toHaveBeenLastCalledWith('GET', '/api/candidates/wards/7/name-changes');
  });
});

describe('the dialog', () => {
  async function openDialog() {
    apiMock.mockResolvedValueOnce(ward(true));
    renderRoPage();
    await userEvent.click(await screen.findByRole('button', { name: 'विवरण सुधारें — पंक्ति 1' }));
    return screen.getByRole('alertdialog');
  }
  async function fill(d: HTMLElement, name: string, reason: string, password: string) {
    if (name !== '') {
      const field = within(d).getByLabelText('नाम (हिंदी)');
      await userEvent.clear(field);
      await userEvent.type(field, name);
    }
    if (reason !== '') await userEvent.type(within(d).getByLabelText(/कारण \(अनिवार्य/), reason);
    if (password !== '') await userEvent.type(within(d).getByLabelText(/RO Password/), password);
  }

  it('pre-fills every editable detail, offers no frozen one, and refuses an incomplete form', async () => {
    const d = await openDialog();
    expect(value(within(d).getByLabelText('नाम (हिंदी)'))).toBe('रमेश कुमर');
    expect(value(within(d).getByLabelText('पार्टी'))).toBe(''); // निर्दलीय
    expect(value(within(d).getByLabelText('लिंग'))).toBe('M');
    expect(within(d).getByLabelText('उम्मीदवार मोबाइल')).toBeTruthy();
    expect(within(d).getByLabelText('उम्मीदवार Category')).toBeTruthy();
    // frozen: no ballot order, no add / remove, no NOTA anywhere in the dialog
    expect(within(d).queryByLabelText(/मतपत्र क्रम|बैलेट क्रम/)).toBeNull();
    expect(within(d).queryByRole('button', { name: /जोड़ें|हटाएँ|नोटा/ })).toBeNull();
    expect(d.textContent).toContain('मतपत्र क्रम नहीं बदलेगा');
    await fill(d, 'रमेश कुमार', 'छोटा', 'pass');
    await userEvent.click(within(d).getByRole('button', { name: /आगे/ }));
    expect(within(d).getByRole('alert').textContent).toContain('कम से कम 10');
    expect(apiMock).toHaveBeenCalledTimes(1); // only the page load
  });

  it('confirm step "पुराना → नया", then saves only the name + reason + password', async () => {
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
      changes: [{ field: 'NAME', label: 'नाम', oldValue: 'रमेश कुमर', newValue: 'रमेश कुमार' }],
      changedAt: '2026-11-20T05:30:00.000Z',
    });
    const after = ward(true, true);
    const first = after.candidates[0];
    if (first) first.nameHindi = 'रमेश कुमार';
    apiMock.mockResolvedValueOnce(after);
    await userEvent.click(within(confirm).getByRole('button', { name: 'विवरण बदलें' }));

    // only the field that changed is sent (every other detail is left out = unchanged)
    expect(apiMock).toHaveBeenCalledWith('POST', '/api/candidates/wards/7/candidates/51/details', {
      currentName: 'रमेश कुमर',
      newName: 'रमेश कुमार',
      reason: 'नामांकन पत्र के अनुसार वर्तनी ठीक की',
      password: 'Secret-RO-1',
    });
    expect(await screen.findByText(/विवरण सुधार दिया गया: नाम — रमेश कुमर → रमेश कुमार/)).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(value(await screen.findByLabelText('पंक्ति 1 नाम'))).toBe('रमेश कुमार');
  });

  it('"वापस" returns to the form with everything kept', async () => {
    const d = await openDialog();
    await fill(d, 'रमेश कुमार', 'नामांकन पत्र के अनुसार वर्तनी', 'pw');
    await userEvent.click(within(d).getByRole('button', { name: /आगे/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'वापस' }));
    expect(value(within(d).getByLabelText('नाम (हिंदी)'))).toBe('रमेश कुमार');
  });

  it('a wrong password: clear message, back to the form, password emptied', async () => {
    const d = await openDialog();
    await fill(d, 'रमेश कुमार', 'नामांकन पत्र के अनुसार वर्तनी', 'wrong');
    await userEvent.click(within(d).getByRole('button', { name: /आगे/ }));
    apiMock.mockRejectedValueOnce(new ApiError(401, 'REAUTH_FAILED', {}));
    await userEvent.click(await screen.findByRole('button', { name: 'विवरण बदलें' }));
    expect(await screen.findByText(/Incorrect password/)).toBeTruthy();
    expect(value(within(d).getByLabelText(/RO Password/))).toBe('');
    expect(value(within(d).getByLabelText('नाम (हिंदी)'))).toBe('रमेश कुमार');
  });

  it('"रुकें" closes without saving', async () => {
    const d = await openDialog();
    await userEvent.click(within(d).getByRole('button', { name: 'रुकें' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});

describe('every editable field, and the frozen ones', () => {
  const FORM = {
    nameHindi: 'रमेश कुमर',
    partyId: null as number | null,
    gender: 'M' as const,
    dob: null,
    ageStated: null,
    education: null,
    mobile: null,
    candidateCategory: null,
    address: null,
    occupation: null,
  };
  const PARTIES = [{ id: 1, shortName: 'BJP', nameHindi: 'भारतीय जनता पार्टी' }];

  it('changedFields finds each field on its own and nothing when the value is the same', () => {
    expect(changedFields(FORM, FORM)).toEqual([]);
    expect(changedFields(FORM, { ...FORM, nameHindi: ' रमेश  कुमर ' })).toEqual([]); // normalized
    expect(changedFields(FORM, { ...FORM, nameHindi: 'रमेश कुमार' })).toEqual(['NAME']);
    expect(changedFields(FORM, { ...FORM, partyId: 1 })).toEqual(['PARTY']);
    expect(changedFields(FORM, { ...FORM, gender: 'F' })).toEqual(['GENDER']);
    expect(changedFields(FORM, { ...FORM, candidateCategory: 'OBC' })).toEqual(['CANDIDATE_CATEGORY']);
    expect(changedFields(FORM, { ...FORM, dob: '1980-05-15' })).toEqual(['DOB']);
    expect(changedFields(FORM, { ...FORM, ageStated: 45 })).toEqual(['AGE_STATED']);
    expect(changedFields(FORM, { ...FORM, education: 'GRADUATE' })).toEqual(['EDUCATION']);
    expect(changedFields(FORM, { ...FORM, mobile: '9876543210' })).toEqual(['MOBILE']);
    expect(changedFields(FORM, { ...FORM, address: 'वार्ड 4, चूरू' })).toEqual(['ADDRESS']);
    expect(changedFields(FORM, { ...FORM, occupation: 'कृषि' })).toEqual(['OCCUPATION']);
    expect(changedFields(FORM, { ...FORM, gender: 'F', mobile: '9876543210' })).toEqual([
      'GENDER',
      'MOBILE',
    ]);
  });

  it('valueText names the party and the empty values', () => {
    expect(valueText('PARTY', FORM, PARTIES)).toBe('निर्दलीय');
    expect(valueText('PARTY', { ...FORM, partyId: 1 }, PARTIES)).toBe('BJP');
    expect(valueText('GENDER', { ...FORM, gender: 'F' }, PARTIES)).toBe('महिला');
    expect(valueText('MOBILE', FORM, PARTIES)).toBe('—');
  });

  it('two fields at once: the confirm step lists ONLY what changed and the body carries only those', async () => {
    apiMock.mockResolvedValueOnce(ward(true));
    renderRoPage();
    await userEvent.click(await screen.findByRole('button', { name: 'विवरण सुधारें — पंक्ति 1' }));
    const d = screen.getByRole('alertdialog');
    await userEvent.selectOptions(within(d).getByLabelText('लिंग'), 'F');
    await userEvent.type(within(d).getByLabelText('उम्मीदवार मोबाइल'), '9876543210');
    await userEvent.type(within(d).getByLabelText(/कारण \(अनिवार्य/), 'नामांकन पत्र के अनुसार ठीक किया');
    await userEvent.type(within(d).getByLabelText(/RO Password/), 'Secret-RO-1');
    await userEvent.click(within(d).getByRole('button', { name: /आगे/ }));

    const list = await screen.findByTestId('change-list');
    const labels = [...list.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(labels).toEqual(['लिंग', 'मोबाइल', 'कारण']); // only what changed

    apiMock.mockResolvedValueOnce({
      candidateId: 51,
      oldName: 'रमेश कुमर',
      nameHindi: 'रमेश कुमर',
      changes: [
        { field: 'GENDER', label: 'लिंग', oldValue: 'पुरुष', newValue: 'महिला' },
        { field: 'MOBILE', label: 'मोबाइल', oldValue: null, newValue: '9876543210' },
      ],
      changedAt: '2026-11-20T05:30:00.000Z',
    });
    apiMock.mockResolvedValueOnce(ward(true, true));
    await userEvent.click(screen.getByRole('button', { name: 'विवरण बदलें' }));
    expect(apiMock).toHaveBeenCalledWith('POST', '/api/candidates/wards/7/candidates/51/details', {
      currentName: 'रमेश कुमर',
      reason: 'नामांकन पत्र के अनुसार ठीक किया',
      password: 'Secret-RO-1',
      gender: 'F',
      mobile: '9876543210',
    });
  });

  it('party change: extra confirmation, a counting warning, and confirmPartyChange in the body', async () => {
    const w = ward(true);
    w.ward.hasEntries = true; // counting of this ward has started
    apiMock.mockResolvedValueOnce(w);
    renderRoPage();
    await userEvent.click(await screen.findByRole('button', { name: 'विवरण सुधारें — पंक्ति 1' }));
    const d = screen.getByRole('alertdialog');
    await userEvent.selectOptions(within(d).getByLabelText('पार्टी'), '1');
    expect(within(d).getByTestId('party-warn').textContent).toContain('मतगणना शुरू हो चुकी है');
    await userEvent.type(within(d).getByLabelText(/कारण \(अनिवार्य/), 'पार्टी का प्रमाण पत्र मिला');
    await userEvent.type(within(d).getByLabelText(/RO Password/), 'Secret-RO-1');
    await userEvent.click(within(d).getByRole('button', { name: /आगे/ }));

    const box = await screen.findByTestId('party-confirm');
    expect(box.textContent).toContain('निर्दलीय');
    expect(box.textContent).toContain('BJP');
    expect(box.textContent).toContain('मतगणना शुरू हो चुकी है');
    // saving without ticking the party box: refused here, the server is never called
    await userEvent.click(screen.getByRole('button', { name: 'विवरण बदलें' }));
    expect(screen.getByRole('alert').textContent).toContain('पार्टी बदलने की पुष्टि करें');
    expect(apiMock).toHaveBeenCalledTimes(1);

    await userEvent.click(within(box).getByRole('checkbox'));
    apiMock.mockResolvedValueOnce({
      candidateId: 51,
      oldName: 'रमेश कुमर',
      nameHindi: 'रमेश कुमर',
      changes: [{ field: 'PARTY', label: 'पार्टी', oldValue: 'निर्दलीय', newValue: 'BJP' }],
      changedAt: '2026-11-20T05:30:00.000Z',
    });
    apiMock.mockResolvedValueOnce(ward(true, true));
    await userEvent.click(screen.getByRole('button', { name: 'विवरण बदलें' }));
    expect(apiMock).toHaveBeenCalledWith('POST', '/api/candidates/wards/7/candidates/51/details', {
      currentName: 'रमेश कुमर',
      reason: 'पार्टी का प्रमाण पत्र मिला',
      password: 'Secret-RO-1',
      partyId: 1,
      confirmPartyChange: true,
    });
  });
});

describe('DM history page', () => {
  it('lists the field, old -> new, reason, who, when with the ward; CSV button', async () => {
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
    expect(within(list).getByText('नाम')).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith('GET', '/api/admin/candidate-name-changes');
    expect(disabled(screen.getByRole('button', { name: 'CSV डाउनलोड करें' }))).toBe(false);
  });
});
