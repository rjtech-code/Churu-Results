// The Excel button beside the booth प्रारूप–14 PDF button: same form, two formats. The PDF button
// keeps its own label, name and URL exactly as before.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoothFormButton } from '../components/BoothFormButton';

const downloadMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  downloadFile: downloadMock,
}));

beforeEach(() => {
  downloadMock.mockClear();
});

const render12A = () => render(<BoothFormButton boothId={7} ballotFor="PS" wardNo={4} boothNo="12A" />);

describe('प्रारूप–14: PDF and Excel side by side', () => {
  it('both buttons are there, each with its own label', () => {
    render12A();
    expect(screen.getByRole('button', { name: /प्रारूप–14 डाउनलोड करें/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /प्रारूप–14 Excel डाउनलोड करें/ })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    // The PDF button's visible label is unchanged.
    expect(screen.getByText('प्रारूप–14 डाउनलोड')).toBeTruthy();
    expect(screen.getByText('प्रारूप–14 Excel')).toBeTruthy();
  });

  it('the PDF button downloads the .pdf, exactly as before', async () => {
    render12A();
    await userEvent.setup().click(screen.getByRole('button', { name: /प्रारूप–14 डाउनलोड करें/ }));
    expect(downloadMock).toHaveBeenCalledWith(
      '/api/ward-forms/booths/7/PS/prarup14.pdf',
      'Prarup14_PS_4_Booth12A.pdf',
    );
  });

  it('the Excel button downloads the .xlsx of the same booth and ballot', async () => {
    render12A();
    await userEvent.setup().click(screen.getByRole('button', { name: /प्रारूप–14 Excel डाउनलोड करें/ }));
    expect(downloadMock).toHaveBeenCalledWith(
      '/api/ward-forms/booths/7/PS/prarup14.xlsx',
      'Prarup14_PS_4_Booth12A.xlsx',
    );
  });

  it('the ZP ballot of the same booth asks for the ZP sheet', async () => {
    render(<BoothFormButton boothId={7} ballotFor="ZP" wardNo={9} boothNo="12A" />);
    await userEvent.setup().click(screen.getByRole('button', { name: /प्रारूप–14 Excel डाउनलोड करें/ }));
    expect(downloadMock).toHaveBeenCalledWith(
      '/api/ward-forms/booths/7/ZP/prarup14.xlsx',
      'Prarup14_ZP_9_Booth12A.xlsx',
    );
  });

  it('while one file is being built both buttons are disabled', async () => {
    let release = (): void => undefined;
    downloadMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            resolve();
          };
        }),
    );
    render12A();
    const excel = screen.getByRole('button', { name: /Excel डाउनलोड करें/ });
    await userEvent.setup().click(excel);
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(excel.textContent).toContain('बन रहा है…');
    release();
  });
});
