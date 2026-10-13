import { render, screen } from '@testing-library/react';
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

describe('पासवर्ड बदलें: generate or type', () => {
  it('"अपने आप बनाएँ" is the default; "खुद पासवर्ड लिखें" shows the fields and live Hindi rules', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'पासवर्ड बदलें' }));
    expect(screen.getByLabelText<HTMLInputElement>('अपने आप बनाएँ').checked).toBe(true);
    expect(screen.queryByLabelText('नया पासवर्ड')).toBeNull();

    await userEvent.click(screen.getByLabelText('खुद पासवर्ड लिखें'));
    const confirm = screen.getAllByRole('button', { name: 'पासवर्ड बदलें' }).at(-1) as HTMLButtonElement;
    await userEvent.type(screen.getByLabelText('नया पासवर्ड'), 'Churu2026!');
    expect(screen.getByTestId('pw-hints').textContent).toContain('यह पासवर्ड बहुत आसान है');
    expect(screen.getByTestId('pw-hints').textContent).not.toContain('एक जैसे नहीं'); // second field empty
    expect(confirm.disabled).toBe(true);

    await userEvent.clear(screen.getByLabelText('नया पासवर्ड'));
    await userEvent.type(screen.getByLabelText('नया पासवर्ड'), 'Kesar7Tila9mor');
    await userEvent.type(screen.getByLabelText('फिर से लिखें'), 'Kesar7Tila9moX');
    expect(screen.getByTestId('pw-hints').textContent).toContain('दोनों नए पासवर्ड एक जैसे नहीं हैं');
    expect(confirm.disabled).toBe(true);

    await userEvent.clear(screen.getByLabelText('फिर से लिखें'));
    await userEvent.type(screen.getByLabelText('फिर से लिखें'), 'Kesar7Tila9mor');
    expect(screen.getByText('✓ पासवर्ड नियमों के अनुसार है')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('अपना पासवर्ड दोबारा लिखें (पुष्टि के लिए)'), 'dm-pass');
    expect(confirm.disabled).toBe(false);
    await userEvent.click(confirm);

    expect(await screen.findByText('✓ पासवर्ड बदल गया')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      method: 'POST',
      path: '/api/admin/users/9/set-password',
      body: { newPassword: 'Kesar7Tila9mor', confirmPassword: 'Kesar7Tila9mor', password: 'dm-pass' },
    });
    // Never shown again.
    expect(document.body.textContent).not.toContain('Kesar7Tila9mor');
    expect(screen.queryByTestId('otp-box')).toBeNull();
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
