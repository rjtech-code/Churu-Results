// The ONE footer of the portal: the same component on the operator pages and on the observer
// dashboard, in each page's own language. The TV screens never render it (see screens tests).
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SiteFooter } from '../components/SiteFooter';

describe('site footer', () => {
  it('defaults to Hindi — the language of the operator pages', () => {
    render(<SiteFooter />);
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toBe('चूरू ज़िला · पंचायत आम चुनाव 2026 · Code Churuइस प्रणाली के बारे में');
    expect(within(footer).getByText('Code Churu').className).toBe('obs-footer-gold');
  });

  it('follows the observer dashboard into English', () => {
    render(<SiteFooter lang="en" />);
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toBe(
      'Churu District · Panchayat General Elections 2026 · Code ChuruAbout this system',
    );
  });

  it('is hidden in print and is not fixed or sticky, so it cannot overlap a form', () => {
    render(<SiteFooter />);
    const footer = screen.getByRole('contentinfo');
    expect(footer.classList.contains('no-print')).toBe(true);
    expect(footer.className).not.toContain('fixed');
    expect(footer.className).not.toContain('sticky');
  });

  it('opens the About panel, in the footer’s language, and closes it again', async () => {
    const user = userEvent.setup();
    render(<SiteFooter />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'इस प्रणाली के बारे में' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('श्री अभिषेक सुराणा');
    expect(dialog.textContent).toContain('कोड चूरू');
    await user.click(within(dialog).getByRole('button', { name: 'बंद करें' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
