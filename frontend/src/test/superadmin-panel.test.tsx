// The redesigned Super Admin panel's new affordances: the header strip (who is logged in, the
// system's state at a glance, the newest backup), the Counting Lock band, the one-line "कब" on every
// task card, and the two calm waiting / error states. What the panel DOES is covered by the existing
// Super Admin tests, which this file leaves alone.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/api';
import { SuperAdminPage } from '../pages/superadmin/SuperAdminPage';
import { overview } from './superadminFixture';
import type { Overview } from '../api/superadminTypes';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { username: 'super_admin', fullName: 'सेटअप अधिकारी', role: 'SUPER_ADMIN' },
    logout: vi.fn(),
    notice: null,
  }),
  useRole: () => 'SUPER_ADMIN',
}));

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
});

/** The panel with one /overview body; anything else the cards ask for is refused loudly. */
function show(ov: Overview) {
  apiMock.mockImplementation((_m: string, path: string) =>
    path === '/api/superadmin/overview'
      ? Promise.resolve(ov)
      : Promise.reject(new Error(`unexpected ${path}`)),
  );
  render(
    <MemoryRouter>
      <SuperAdminPage />
    </MemoryRouter>,
  );
}

function must(el: Element | null | undefined, what: string): HTMLElement {
  if (el === null || el === undefined) throw new Error(`${what} missing`);
  return el as HTMLElement;
}

describe('header strip', () => {
  it('names the panel and says when the newest backup was written', async () => {
    show(overview());
    const head = must(document.querySelector('.sa-head'), 'page head');
    expect(head.textContent).toContain('Super Admin');
    expect(head.textContent).toContain('अंतिम backup');
    // The time itself is formatted elsewhere; here: a real date, not a dash.
    await waitFor(() => {
      expect(screen.getByTestId('sa-last-backup').textContent).toMatch(/\d\d\/\d\d/);
    });
  });

  it('says so plainly when there is no backup yet', async () => {
    show(overview({ lastBackupAt: null }));
    expect((await screen.findByTestId('sa-last-backup')).textContent).toBe('अभी कोई backup नहीं');
  });

  it('shows the whole state at a glance, RO logins included', async () => {
    show(overview());
    const status = must(await screen.findByTestId('sa-lock'), 'lock').closest('.sa-status');
    const strip = must(status, 'status strip');
    for (const [label, value] of [
      ['Panchayat Samitis', '13'],
      ['PS wards', '231'],
      ['ZP wards', '39'],
      ['Booths', '1,371'],
      ['उम्मीदवार', '958'],
      ['Parties', '8'],
      ['RO logins', '14'],
      ['Entries', '1,200'],
      ['Declared wards', '7'],
      ['कुल voters', '12,00,000'],
    ] as const) {
      const tile = must(
        [...strip.querySelectorAll('.sa-count')].find((li) => li.textContent.includes(label)),
        `tile ${label}`,
      );
      expect(within(tile).getByText(value)).toBeTruthy();
    }
  });
});

describe('the Counting Lock band', () => {
  it('OFF: the word, the state and the way to turn it on', async () => {
    show(overview());
    const lock = await screen.findByTestId('sa-lock');
    expect(lock.className).toContain('sa-lock-off');
    expect(lock.textContent).toContain('OFF');
    expect(within(lock).getByRole('button', { name: 'Lock ON करें' })).toBeTruthy();
  });

  it('ON: its own band, the word ON, and what is shut', async () => {
    show(overview({ countingLocked: true }));
    const lock = await screen.findByTestId('sa-lock');
    expect(lock.className).toContain('sa-lock-on');
    expect(lock.textContent).toContain('ON');
    expect(lock.textContent).toContain('Reset और booth बदलाव बंद हैं');
    expect(within(lock).getByRole('button', { name: 'Lock OFF करें' })).toBeTruthy();
  });
});

describe('every task says when to use it', () => {
  it('each card carries a one-line "कब"', async () => {
    show(overview());
    await screen.findByTestId('sa-lock');
    for (const id of [
      'card-booth-add',
      'card-dm',
      'card-guide',
      'card-counting-data',
      'card-test-data',
      'card-booth-delete',
      'card-master-data',
    ]) {
      const when = must(screen.getByTestId(id).querySelector('.sa-when'), `"कब" of ${id}`);
      expect(when.textContent).toContain('कब:');
      expect(when.textContent.length).toBeGreaterThan(20);
    }
  });

  it('the two resets are told apart by a badge as well as their names', async () => {
    show(overview());
    const narrow = await screen.findByTestId('card-counting-data');
    const full = screen.getByTestId('card-test-data');
    expect(must(narrow.querySelector('.sa-badge'), 'badge').textContent).toBe('छोटा reset');
    expect(must(full.querySelector('.sa-badge'), 'badge').textContent).toBe('बड़ा reset');
  });
});

describe('waiting and failing', () => {
  it('shows the shape of the page while /overview is on its way, never a blank screen', () => {
    apiMock.mockImplementation(() => new Promise(() => undefined));
    render(
      <MemoryRouter>
        <SuperAdminPage />
      </MemoryRouter>,
    );
    const loading = screen.getByTestId('sa-loading');
    expect(loading.textContent).toContain('लोड हो रहा है…');
    expect(loading.querySelectorAll('.obs-skeleton-line').length).toBeGreaterThan(0);
  });

  it('a failed /overview stays calm and offers to try again', async () => {
    apiMock.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', {}));
    render(
      <MemoryRouter>
        <SuperAdminPage />
      </MemoryRouter>,
    );
    const panel = must((await screen.findByTestId('panel-error')).closest('.sa-error-panel'), 'error panel');
    expect(panel.textContent).toContain('फिर से कोशिश करें');
    expect(screen.queryByTestId('sa-loading')).toBeNull();

    const ov = overview();
    apiMock.mockImplementation((_m: string, path: string) =>
      path === '/api/superadmin/overview'
        ? Promise.resolve(ov)
        : Promise.resolve({ booths: [], psWards: [], zpWards: [] }),
    );
    await userEvent.setup().click(within(panel).getByRole('button', { name: 'फिर से कोशिश करें' }));
    expect(await screen.findByTestId('sa-lock')).toBeTruthy();
  });
});
