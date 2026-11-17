// "चेक मीमो (Excel)" beside the Part-II / Prarup-7 buttons on the ward page: the memo is offered
// for EVERY ward the user may read (it exists to check the counting as it stands), so it is there
// even while no official form is available yet.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WardFormDownloads } from '../components/WardFormDownloads';

const apiMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
  downloadFile: downloadMock,
}));

const forms = (available: boolean) => ({
  forms: {
    part2: { available, reason: available ? null : 'वार्ड अभी घोषित नहीं है' },
    prarup7: { available, reason: available ? null : 'वार्ड अभी घोषित नहीं है' },
  },
});

beforeEach(() => {
  apiMock.mockReset();
  downloadMock.mockClear();
});

const show = (available: boolean) => {
  apiMock.mockResolvedValue(forms(available));
  render(
    <MemoryRouter>
      <WardFormDownloads wardId={42} />
    </MemoryRouter>,
  );
};

describe('चेक मीमो (Excel)', () => {
  it('stands beside the two form buttons when the ward is declared', async () => {
    show(true);
    expect(await screen.findByRole('button', { name: 'चेक मीमो (Excel)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download Part 2 / भाग-2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download Format 7 / प्ररूप-7' })).toBeTruthy();
  });

  it('is offered even when no official form is available yet', async () => {
    show(false);
    expect(await screen.findByRole('button', { name: 'चेक मीमो (Excel)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download Part 2/ })).toBeNull();
  });

  it('the BLANK प्ररूप–7 stands beside them, and is offered whatever the ward status', async () => {
    show(true);
    expect(await screen.findByRole('button', { name: 'प्ररूप-7 खाली' })).toBeTruthy();
    show(false);
    // No official form yet, but the blank one is for exactly that moment.
    expect((await screen.findAllByRole('button', { name: 'प्ररूप-7 खाली' })).length).toBeGreaterThan(0);
  });

  it('downloads the blank प्ररूप–7 as its own file', async () => {
    show(true);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'प्ररूप-7 खाली' }));
    await waitFor(() => {
      expect(downloadMock).toHaveBeenCalledWith('/api/ward-forms/42/prarup7-blank.pdf', 'Prarup-7_Blank.pdf');
    });
  });

  it('downloads the ward’s check memo as .xlsx', async () => {
    show(true);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'चेक मीमो (Excel)' }));
    await waitFor(() => {
      expect(downloadMock).toHaveBeenCalledWith('/api/ward-forms/42/check-memo.xlsx', 'CheckMemo.xlsx');
    });
  });
});
