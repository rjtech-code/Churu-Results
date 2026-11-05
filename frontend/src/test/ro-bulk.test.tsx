import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoBulkCheck, RoBulkSaved } from '../api/adminTypes';
import { RoBulkAddPage } from '../pages/admin/RoBulkAddPage';

const calls = vi.hoisted(() => ({
  api: vi.fn<(method: string, path: string, body?: unknown) => Promise<unknown>>(),
  save: vi.fn<(file: { fileName: string; fileBase64: string }) => void>(),
}));

vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: calls.api,
  saveBase64Xlsx: calls.save,
}));
vi.mock('../auth/AuthContext', () => ({ useRole: () => 'DM' }));

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
  calls.api.mockReset();
  calls.save.mockReset();
});

const CHECK: RoBulkCheck = {
  ok: true,
  errors: [],
  sha256: 'x',
  expectedSeats: ['PS:3'],
  totals: { total: 3, create: 1, exists: 1, errors: 1 },
  rows: [
    {
      rowNumber: 2,
      status: 'NEW',
      seat: 'PS:3',
      seatLabel: 'पंचायत समिति सरदारशहर',
      fullName: 'रमेश',
      phone: '9829011111',
      reasons: [],
    },
    {
      rowNumber: 3,
      status: 'EXISTS',
      seat: 'ZP',
      seatLabel: 'ज़िला परिषद',
      fullName: 'सीमा',
      phone: '9829022222',
      reasons: ['पहले से मौजूद है, छोड़ा गया — इस पद का RO खाता पहले से बना है'],
    },
    {
      rowNumber: 4,
      status: 'ERROR',
      seat: null,
      seatLabel: null,
      fullName: 'गलत',
      phone: null,
      reasons: ['"मोबाइल" खाली है'],
    },
  ],
};
const SAVED: RoBulkSaved = {
  totals: CHECK.totals,
  created: [
    {
      seatLabel: 'पंचायत समिति सरदारशहर',
      fullName: 'रमेश',
      phone: '9829011111',
      username: 'ro_sar_k7m2',
      password: 'Abcdefgh23456789',
    },
  ],
  credentialsFile: { fileName: 'ro-login.xlsx', fileBase64: 'UEsDBA==' },
};

async function pickAndCheck() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <RoBulkAddPage />
    </MemoryRouter>,
  );
  const file = new File([new Uint8Array([80, 75, 3, 4])], 'ro.xlsx');
  await user.upload(screen.getByLabelText(/Excel फ़ाइल यहाँ छोड़ें या चुनें/), file);
  await user.click(screen.getByRole('button', { name: '2. जाँच करें' }));
  await screen.findByTestId('bulk-rows');
  return user;
}

describe('Excel से RO जोड़ें', () => {
  it('shows the preview; a wrong row blocks the save until the DM ticks the box', async () => {
    calls.api.mockResolvedValueOnce(CHECK);
    const user = await pickAndCheck();
    const rows = within(screen.getByTestId('bulk-rows')).getAllByRole('row');
    expect(rows[1]?.textContent).toContain('✓ नया बनेगा');
    expect(rows[2]?.textContent).toContain('पहले से मौजूद है, छोड़ा गया');
    expect(rows[3]?.textContent).toContain('"मोबाइल" खाली है');
    const saveButton = screen.getByRole('button', { name: '4. सेव करें' });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByLabelText(/गलत पंक्तियाँ छोड़कर 1 सही पंक्तियाँ सेव करें/));
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('save sends the DM password and the previewed seats, then downloads the login file', async () => {
    calls.api.mockResolvedValueOnce(CHECK);
    const user = await pickAndCheck();
    await user.click(screen.getByLabelText(/गलत पंक्तियाँ छोड़कर/));
    await user.click(screen.getByRole('button', { name: '4. सेव करें' }));
    let release: (v: RoBulkSaved) => void = () => undefined;
    calls.api.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    await user.type(screen.getByLabelText(/Admin Password/), 'dm-secret');
    const confirm = screen.getByRole('button', { name: 'हाँ, खाते बनाएँ' });
    await user.click(confirm);
    // While saving, the button is disabled: a double click cannot save twice.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'हो रहा है…' }).disabled).toBe(true);
    release(SAVED);
    await screen.findByTestId('bulk-created');

    expect(calls.api).toHaveBeenCalledTimes(2);
    expect(calls.api.mock.calls[1]?.[1]).toBe('/api/admin/users/bulk/save');
    expect(calls.api.mock.calls[1]?.[2]).toMatchObject({
      password: 'dm-secret',
      allowErrors: true,
      expectedSeats: ['PS:3'],
    });
    await waitFor(() => {
      expect(calls.save).toHaveBeenCalledWith(SAVED.credentialsFile);
    });
    expect(screen.getByTestId('bulk-created').textContent).toContain('Abcdefgh23456789');
    expect(screen.getByRole('status').textContent).toContain('1 नए RO खाते बन गए');
  });
});
