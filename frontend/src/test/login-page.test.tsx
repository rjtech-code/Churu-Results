import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TRAINING_LINKS } from '../config/trainingLinks';
import { BrandPanel } from '../pages/login/BrandPanel';
import { EmblemFeature } from '../pages/login/EmblemFeature';
import { LoginCard } from '../pages/login/LoginCard';
import { TrainingLinks } from '../pages/login/TrainingLinks';

const loginMock = vi.hoisted(() => vi.fn());
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ login: loginMock, notice: null }) }));

describe('login page training links', () => {
  it('renders every link from the config, opening safely in a new tab', () => {
    render(<BrandPanel />);
    const links = within(screen.getByRole('list')).getAllByRole('link');
    expect(links).toHaveLength(TRAINING_LINKS.length);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(TRAINING_LINKS.map((c) => c.url));
    expect(links.map((a) => a.textContent)).toEqual(
      TRAINING_LINKS.map((c) => expect.stringContaining(`${c.labelEn}${c.labelHi}`) as unknown),
    );
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('a link with an empty url is not rendered', () => {
    render(
      <TrainingLinks
        links={[
          { id: 'a', labelEn: 'Shown', labelHi: 'दिखेगा', url: 'https://example.test/a' },
          { id: 'b', labelEn: 'Hidden', labelHi: 'छिपा', url: '  ' },
        ]}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it('no card at all when every url is empty', () => {
    const { container } = render(
      <TrainingLinks links={[{ id: 'a', labelEn: 'X', labelHi: 'य', url: '' }]} />,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('login page emblem', () => {
  it('shows the image as decoration (empty alt) when a url is given', () => {
    const { container } = render(<EmblemFeature src="/assets/pillar.png" />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/assets/pillar.png');
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('renders nothing when the image file is missing', () => {
    const { container } = render(<EmblemFeature src={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('removes itself if the image fails to load (no broken-image icon)', () => {
    const { container } = render(<EmblemFeature src="/assets/broken.png" />);
    const img = container.querySelector('img');
    if (img === null) throw new Error('img missing');
    fireEvent.error(img);
    expect(container.innerHTML).toBe('');
  });
});

describe('login card password eye toggle', () => {
  const renderCard = () =>
    render(
      <MemoryRouter>
        <LoginCard />
      </MemoryRouter>,
    );

  it('shows and hides the password, with a matching button label', async () => {
    const user = userEvent.setup();
    renderCard();
    const input = screen.getByLabelText('पासवर्ड');
    expect(input.getAttribute('type')).toBe('password');
    await user.click(screen.getByRole('button', { name: 'पासवर्ड दिखाएँ' }));
    expect(input.getAttribute('type')).toBe('text');
    const hide = screen.getByRole('button', { name: 'पासवर्ड छिपाएँ' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');
    await user.click(hide);
    expect(input.getAttribute('type')).toBe('password');
  });

  it('hides the password again after a submit', async () => {
    loginMock.mockRejectedValueOnce(new Error('no'));
    const user = userEvent.setup();
    renderCard();
    await user.type(screen.getByLabelText('यूज़रनेम'), 'ro_churu');
    await user.type(screen.getByLabelText('पासवर्ड'), 'secret-1');
    await user.click(screen.getByRole('button', { name: 'पासवर्ड दिखाएँ' }));
    expect(screen.getByLabelText('पासवर्ड').getAttribute('type')).toBe('text');
    await user.click(screen.getByRole('button', { name: 'लॉगिन करें' }));
    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('ro_churu', 'secret-1');
    });
    expect(screen.getByLabelText('पासवर्ड').getAttribute('type')).toBe('password');
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
