import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SiteFooter } from '../components/SiteFooter';

describe('site footer', () => {
  it('shows the one-line credit with Code Churu highlighted', () => {
    render(<SiteFooter />);
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toBe('Proudly crafted by Code Churu for Churu District');
    expect(screen.getByText('Code Churu').className).toBe('site-footer-name');
    expect(footer.classList.contains('no-print')).toBe(true);
  });
});
