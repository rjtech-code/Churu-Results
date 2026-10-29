import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/api';
import { LoginCard } from '../pages/login/LoginCard';
import { GuidePage } from '../pages/superadmin/GuidePage';
import { GUIDE } from '../pages/superadmin/guideContent';
import { ActionButton, ConfirmDialog, Impact, Problems } from '../pages/superadmin/parts';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn(), notice: null }),
  useRole: () => 'SUPER_ADMIN',
}));

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

describe('Super Admin login link', () => {
  it('the normal login has a small "Super Admin" link; the Super Admin login links back', () => {
    const { unmount } = render(
      <MemoryRouter>
        <LoginCard />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Super Admin' }).getAttribute('href')).toBe('/superadmin/login');
    unmount();
    render(
      <MemoryRouter>
        <LoginCard superAdmin />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading').textContent).toBe('Super Admin Login');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/login');
  });
});

describe('guide', () => {
  it('shows every section from the content file, with the 9-step order', () => {
    render(
      <MemoryRouter>
        <GuidePage />
      </MemoryRouter>,
    );
    for (const s of GUIDE) expect(screen.getByRole('heading', { name: s.heading })).toBeTruthy();
    const order = document.getElementById('order');
    if (order === null) throw new Error('order section missing');
    const steps = within(order).getAllByRole('listitem');
    expect(steps).toHaveLength(9);
    expect(steps[8]?.textContent).toContain('Counting Lock ON');
    expect(document.body.textContent).toContain('Audit log कभी नहीं मिटता');
  });
});

describe('panel parts', () => {
  it('a disabled button always says why', () => {
    render(<ActionButton label="Reset" reason="Counting Lock ON है" onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Reset' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).not.toBeNull();
    expect(screen.getByText('Counting Lock ON है')).toBeTruthy();
  });

  it('the impact summary lists counts to delete and says the audit log stays', () => {
    render(
      <Impact
        deletes={[
          ['उम्मीदवार', 958],
          ['booth entries', 4120],
          ['voided entries', 0],
        ]}
        keeps="Booths और voters।"
      />,
    );
    expect(screen.getByText('958')).toBeTruthy();
    expect(screen.getByText('4,120')).toBeTruthy();
    expect(screen.queryByText(/voided/)).toBeNull();
    expect(screen.getByText('Audit log कभी नहीं मिटता।')).toBeTruthy();
  });

  it('confirm: typed word + password, then the success screen with the backup file name', async () => {
    const run = vi.fn((password: string | undefined) => {
      expect(password).toBe('secret-pass');
      return Promise.resolve({
        title: 'हो गया',
        lines: ['5 उम्मीदवार हटाए गए'],
        backupFile: 'churu-x.sql.gz',
      });
    });
    render(
      <ConfirmDialog
        title="Reset"
        summary={<p>x</p>}
        confirmLabel="साफ़ करें"
        word="RESET"
        askPassword
        danger
        run={run}
        onClose={vi.fn()}
      />,
    );
    const go = screen.getByRole<HTMLButtonElement>('button', { name: 'साफ़ करें' });
    expect(go.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/टाइप करें/), 'RESET');
    expect(go.disabled).toBe(true); // password still missing
    await userEvent.type(screen.getByLabelText(/Password/), 'secret-pass');
    await userEvent.click(go);
    expect(await screen.findByTestId('sa-done')).toBeTruthy();
    expect(screen.getByText('churu-x.sql.gz')).toBeTruthy();
    expect(screen.getByText('5 उम्मीदवार हटाए गए')).toBeTruthy();
  });

  it('confirm: inside the 15-minute window no password field; problems stay on the form', async () => {
    const run = vi.fn(() => Promise.reject(new Problems(['Voters file: Booth 4 नहीं है'])));
    render(
      <ConfirmDialog
        title="Reset"
        summary={<p>x</p>}
        confirmLabel="चलाएँ"
        word="RESET"
        askPassword={false}
        run={run}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/Password/)).toBeNull();
    await userEvent.type(screen.getByLabelText(/टाइप करें/), 'RESET');
    await userEvent.click(screen.getByRole('button', { name: 'चलाएँ' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Voters file: Booth 4 नहीं है')).toBeTruthy();
  });

  it('confirm: when the window has ended, the password field comes back', async () => {
    const run = vi.fn(() => Promise.reject(new ApiError(401, 'PASSWORD_REQUIRED', {})));
    render(
      <ConfirmDialog
        title="Reset"
        summary={<p>x</p>}
        confirmLabel="चलाएँ"
        word="RESET"
        askPassword={false}
        run={run}
        onClose={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/टाइप करें/), 'RESET');
    await userEvent.click(screen.getByRole('button', { name: 'चलाएँ' }));
    expect(await screen.findByLabelText(/Password/)).toBeTruthy();
  });
});
