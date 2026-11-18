// The PS_RO's जिला परिषद ward page offers the चेक मीमो, and nothing else of that ward's forms:
// भाग-2 and प्ररूप-7 of a ZP ward belong to the ZP RO. Which booths the sheet holds is decided on
// the server from the login, so the request carries nothing but the ward id.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PsZpWardBooths } from '../api/types';
import { ZpWardPage } from '../pages/ZpWardPage';

const apiMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
  downloadFile: downloadMock,
}));
vi.mock('../auth/AuthContext', () => ({ useRole: () => 'PS_RO' }));

const WARD: PsZpWardBooths = {
  ward: { id: 200, wardNo: 7, state: 'OPEN' },
  progress: null,
  booths: [
    {
      boothId: 9,
      panchayatSamiti: 'चूरू',
      boothNo: '3',
      nameHindi: 'विद्यालय 3',
      registeredVotersTotal: 900,
      entered: true,
      entryId: 55,
      enteredAt: null,
    },
  ],
  ballot: [],
};

beforeEach(() => {
  apiMock.mockReset();
  downloadMock.mockClear();
  apiMock.mockImplementation((_m: string, path: string) =>
    path === '/api/counting/zp-wards/200/ps-booths'
      ? Promise.resolve(WARD)
      : Promise.reject(new Error(`unexpected ${path}`)),
  );
  render(
    <MemoryRouter initialEntries={['/zp/200']}>
      <Routes>
        <Route path="/zp/:wardId" element={<ZpWardPage />} />
      </Routes>
    </MemoryRouter>,
  );
});

describe("चेक मीमो on the PS_RO's ZP ward page", () => {
  it('offers the memo and says what the sheet will and will not hold', async () => {
    expect(await screen.findByRole('button', { name: 'चेक मीमो (Excel)' })).toBeTruthy();
    expect(screen.getByText('चेक मीमो में केवल आपकी पंचायत समिति के बूथ आएँगे।')).toBeTruthy();
  });

  it('downloads it for this ward, with no Panchayat Samiti in the request', async () => {
    await userEvent.setup().click(await screen.findByRole('button', { name: 'चेक मीमो (Excel)' }));
    await waitFor(() => {
      expect(downloadMock).toHaveBeenCalledWith('/api/ward-forms/200/check-memo.xlsx', 'CheckMemo.xlsx');
    });
  });

  it("does not offer the ZP RO's own forms", async () => {
    await screen.findByRole('button', { name: 'चेक मीमो (Excel)' });
    expect(screen.queryByRole('button', { name: /भाग-2/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /प्ररूप-7/ })).toBeNull();
  });
});
