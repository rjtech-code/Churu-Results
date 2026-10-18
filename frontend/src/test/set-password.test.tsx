import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chosenPasswordProblems, isWeakPassword } from '../components/chosenPassword';
import { UserSeatPage } from '../pages/admin/UserSeatPage';

const calls: { method: string; path: string; body: unknown }[] = [];

vi.mock('../api/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/api')>();
  return {
    ...real,
    api: vi.fn((method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === 'GET')
        return Promise.resolve({
          seats: [
            {
              seat: 'PS:4',
              label: 'बीदासर पंचायत समिति',
              account: {
                id: 9,
                username: 'ro_bid_k7m2',
                fullName: 'राम',
                isActive: true,
                lastLoginAt: null,
                locked: false,
              },
              olderAccounts: 0,
            },
          ],
        });
      if (path.endsWith('/generate-password')) return Promise.resolve({ password: 'Gen7ratedPass2xyz' });
      if (path.endsWith('/view-password'))
        return Promise.resolve({ username: 'ro_bid_k7m2', password: 'Current4Pass8abc' });
      if (path.endsWith('/update-credentials'))
        return Promise.resolve({
          username: (body as { username: string }).username,
          password: (body as { newPassword?: string }).newPassword ?? null,
        });
      return Promise.resolve({ ok: true });
    }),
  };
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/admin/users/PS:4']}>
      <Routes>
        <Route path="/admin/users/:seat" element={<UserSeatPage />} />
      </Routes>
    </MemoryRouter>,
  );
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
  calls.length = 0;
});

describe('बदलें: one form for username and password', () => {
  const open = async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'बदलें' }));
  };
  const dmPassword = () => screen.getByLabelText('Admin Password (सत्यापन हेतु)');
  const save = () => screen.getByRole<HTMLButtonElement>('button', { name: 'सेव करें' });

  it('typing a password shows the live Hindi rules; "सेव करें" waits for a change and valid rules', async () => {
    await open();
    expect(screen.getByLabelText<HTMLInputElement>('यूज़रनेम').value).toBe('ro_bid_k7m2');
    expect(save().disabled).toBe(true); // nothing changed yet
    await userEvent.type(screen.getByLabelText(/^पासवर्ड/), 'Churu2026!');
    expect(screen.getByTestId('pw-hints').textContent).toContain('यह पासवर्ड बहुत आसान है');
    expect(save().disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText(/^पासवर्ड/));
    await userEvent.type(screen.getByLabelText(/^पासवर्ड/), 'Kesar7Tila9mor');
    expect(screen.getByText('✓ पासवर्ड नियमों के अनुसार है')).toBeTruthy();
    expect(save().disabled).toBe(false);
  });

  it('saves username + typed password in ONE call and then shows the password with "कॉपी करें"', async () => {
    await open();
    await userEvent.clear(screen.getByLabelText('यूज़रनेम'));
    await userEvent.type(screen.getByLabelText('यूज़रनेम'), 'ro_bid_new');
    await userEvent.type(screen.getByLabelText(/^पासवर्ड/), 'Kesar7Tila9mor');
    await userEvent.type(dmPassword(), 'dm-pass');
    await userEvent.click(save());

    expect(await screen.findByTestId('otp-box')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'कॉपी करें' })).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      method: 'POST',
      path: '/api/admin/users/9/update-credentials',
      body: { username: 'ro_bid_new', newPassword: 'Kesar7Tila9mor', password: 'dm-pass' },
    });
  });

  it('"अपने आप बनाएं" fills a generated password; "देखें" asks "are you sure?" (no password) and fills the current one', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'अपने आप बनाएं' }));
    expect(screen.getByLabelText<HTMLInputElement>(/^पासवर्ड/).value).toBe('Gen7ratedPass2xyz');
    expect(calls.at(-1)?.path).toBe('/api/admin/users/generate-password');

    // "रुकें" in the popup: nothing is fetched.
    await userEvent.click(screen.getByRole('button', { name: 'देखें' }));
    const popup = await screen.findByRole('alertdialog', { name: 'पासवर्ड देखें?' });
    expect(within(popup).queryByLabelText('Admin Password (सत्यापन हेतु)')).toBeNull();
    await userEvent.click(within(popup).getByRole('button', { name: 'रुकें' }));
    expect(screen.queryByRole('alertdialog', { name: 'पासवर्ड देखें?' })).toBeNull();
    expect(calls.some((c) => c.path.endsWith('/view-password'))).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'देखें' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog', { name: 'पासवर्ड देखें?' })).getByRole('button', {
        name: 'हाँ, दिखाएँ',
      }),
    );
    await vi.waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>(/^पासवर्ड/).value).toBe('Current4Pass8abc');
    });
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      path: '/api/admin/users/9/view-password',
      body: {},
    });
    expect(screen.queryByRole('alertdialog', { name: 'पासवर्ड देखें?' })).toBeNull();
    // The viewed password is not a change: saving stays disabled until something changes.
    expect(save().disabled).toBe(true);
  });
});

describe('the same rules as the server', () => {
  it('weak variations, username, letter + digit, length', () => {
    for (const weak of ['Churu2026!', 'P@ssword123', 'Admin12345', 'Election2026'])
      expect([weak, isWeakPassword(weak)]).toEqual([weak, true]);
    expect(chosenPasswordProblems('xro_bid_k7m2x9', 'xro_bid_k7m2x9', 'ro_bid_k7m2')).toEqual([
      'PASSWORD_HAS_USERNAME',
    ]);
    expect(chosenPasswordProblems('nodigitshere', 'nodigitshere', 'u')).toEqual([
      'PASSWORD_NEEDS_LETTER_AND_DIGIT',
    ]);
    expect(chosenPasswordProblems('Ab3', 'Ab3', 'u')).toEqual(['PASSWORD_TOO_SHORT']);
    expect(chosenPasswordProblems('Kesar7Tila9mor', 'Kesar7Tila9mor', 'ro_x')).toEqual([]);
  });
});
