// The counting-only reset card and the counting-data download that sits above both resets:
// the two resets must never be confusable, so each says when to use it and the confirm dialog of
// the narrow one shows what goes AND what stays, both with real counts.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CountingDataCard } from '../pages/superadmin/CountingDataCard';
import { SuperAdminPage } from '../pages/superadmin/SuperAdminPage';
import { OV, overview } from './superadminFixture';

const apiMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
  downloadFile: downloadMock,
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn(), notice: null }),
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

/** A required element: fails the test loudly instead of hiding a missing node. */
function must(el: Element | null | undefined, what: string): HTMLElement {
  if (el === null || el === undefined) throw new Error(`${what} missing`);
  return el as HTMLElement;
}

beforeEach(() => {
  apiMock.mockReset();
  downloadMock.mockClear();
});

describe('counting-only reset card', () => {
  it('says when to use it and lists what goes AND what stays with real counts', () => {
    render(<CountingDataCard ov={overview()} onChanged={vi.fn()} />);
    const card = screen.getByTestId('card-counting-data');
    expect(card.textContent).toContain('मतगणना डेटा हटाएँ');
    expect(card.textContent).toContain('कब:');
    expect(card.textContent).toContain('mock counting के बाद');

    const impact = within(card).getByTestId('counting-impact');
    const goes = must(impact.querySelector('.sa-impact-del'), 'deletes column');
    const stays = must(impact.querySelector('.sa-impact-keep'), 'keeps column');
    // Deletes: entries, declarations, voided entries.
    expect(within(goes).getByText('1,200')).toBeTruthy();
    expect(within(goes).getByText('9')).toBeTruthy();
    // Keeps, each with its own number — not just a sentence.
    expect(within(stays).getByText('958')).toBeTruthy();
    expect(within(stays).getByText('270')).toBeTruthy();
    expect(stays.textContent).toContain('उम्मीदवार');
    expect(stays.textContent).toContain('candidate list lock');
    expect(stays.textContent).toContain('विवरण सुधार');
    expect(stays.textContent).toContain('Audit log कभी नहीं मिटता।');
  });

  it('the confirm dialog repeats both columns and names the other reset', async () => {
    render(<CountingDataCard ov={overview()} onChanged={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'मतगणना डेटा हटाएँ' }));
    const dialog = must(document.querySelector('dialog'), 'dialog');
    expect(dialog.textContent).toContain('परीक्षण डेटा साफ़ करें'); // points at the full reset
    const impact = within(dialog).getByTestId('counting-impact');
    expect(impact.querySelector('.sa-impact-del')?.textContent).toContain('booth entries');
    const stays = must(impact.querySelector('.sa-impact-keep'), 'keeps column');
    expect(within(stays).getByText('958')).toBeTruthy();
    expect(within(stays).getByText('5')).toBeTruthy();
    expect(dialog.textContent).toContain('पहले अपने-आप backup बनेगा।');
    expect(within(dialog).getByText(/RESET/)).toBeTruthy();
  });

  it('calls the counting-only endpoint and reports what was kept', async () => {
    apiMock.mockResolvedValue({
      deleted: {
        boothEntries: 1200,
        postalEntries: 40,
        declaredWards: 7,
        declarationVersions: 9,
        voidedEntries: 3,
      },
      kept: {
        candidates: 958,
        lockedWards: 270,
        readyWards: 265,
        nameChanges: 5,
        booths: 1371,
        wards: 274,
      },
      backupFile: 'churu-counting-data-20261120-101502.sql.gz',
    });
    const user = userEvent.setup();
    render(<CountingDataCard ov={overview()} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'मतगणना डेटा हटाएँ' }));
    await user.type(screen.getByLabelText(/टाइप करें/), 'RESET');
    await user.type(screen.getByLabelText(/Password/), 'secret-pass');
    const dialog = must(document.querySelector('dialog'), 'dialog');
    await user.click(within(dialog).getByRole('button', { name: 'मतगणना डेटा हटाएँ' }));

    expect(apiMock).toHaveBeenCalledWith('POST', '/api/superadmin/counting-data/reset', {
      confirmText: 'RESET',
      password: 'secret-pass',
    });
    const done = await screen.findByTestId('sa-done');
    expect(done.textContent).toContain('मतगणना डेटा हट गया');
    expect(done.textContent).toContain('958 उम्मीदवार और 270 ward lock बचे हैं');
    expect(done.textContent).toContain('churu-counting-data-20261120-101502.sql.gz');
  });

  it('a blocked reset says why and the button is disabled', () => {
    render(
      <CountingDataCard
        ov={overview({
          countingData: {
            ...OV.countingData,
            allowed: false,
            reason: 'Counting Lock ON है — पहले Lock OFF करें',
          },
        })}
        onChanged={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'मतगणना डेटा हटाएँ' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Counting Lock ON है — पहले Lock OFF करें')).toBeTruthy();
  });
});

describe('the danger zone as a whole', () => {
  it('the narrow reset comes first and each reset says when to use it', async () => {
    apiMock.mockImplementation((_m: string, path: string) =>
      path === '/api/superadmin/overview'
        ? Promise.resolve(overview())
        : Promise.reject(new Error(`unexpected ${path}`)),
    );
    render(
      <MemoryRouter>
        <SuperAdminPage />
      </MemoryRouter>,
    );
    const narrow = await screen.findByTestId('card-counting-data');
    const full = screen.getByTestId('card-test-data');

    // The narrow reset is offered before the full one.
    const order = (el: Element) => [...document.querySelectorAll('[data-testid]')].indexOf(el);
    expect(order(narrow)).toBeLessThan(order(full));

    // Each reset carries its own "when", and they say different things.
    const whenOf = (card: HTMLElement) => card.querySelector('.sa-when')?.textContent ?? '';
    expect(whenOf(narrow)).toContain('mock counting के बाद');
    expect(whenOf(full)).toContain('उम्मीदवार सूची भी नई');
    expect(whenOf(narrow)).not.toBe(whenOf(full));
    // The full reset warns that it also clears candidates and locks.
    expect(whenOf(full)).toContain('भी');
  });
});
