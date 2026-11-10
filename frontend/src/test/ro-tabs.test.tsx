// The PS_RO's पंचायत समिति / जिला परिषद tabs on every RO page (page shell), and the one leave check
// (LeaveGuard) of forms with typed input.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Role } from '../api/types';
import { LeaveGuard } from '../components/LeaveGuard';
import { RequireRole } from '../components/RequireRole';
import { RoTabs, RoTabsProvider, ballotOfPath, usePageBallot } from '../components/RoTabs';

const auth = vi.hoisted((): { role: Role } => ({ role: 'PS_RO' }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'u', fullName: 'RO', role: auth.role, panchayatSamiti: null },
    logout: () => Promise.resolve(),
  }),
  useRole: () => auth.role,
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

/** A form like the entry forms: dirty once typed; "सेव" saves and goes back to the ward. */
function Form({ to }: { to: string }) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  const allow = useRef(false);
  return (
    <>
      <LeaveGuard dirty={value !== '' && !saved} allowRef={allow} />
      <label>
        मत
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          allow.current = true;
          setSaved(true);
          void router?.navigate(to);
        }}
      >
        सेव
      </button>
    </>
  );
}

function EditLike() {
  usePageBallot('ZP');
  return <p>edit page</p>;
}

let router: ReturnType<typeof createMemoryRouter> | null = null;

function renderAt(url: string, withShell = false) {
  const page = (text: string) => <p>{text}</p>;
  const children = [
    { path: '/wards', element: page('ward list') },
    { path: '/wards/:wardId', element: page('PS ward') },
    { path: '/wards/:wardId/booths/:boothId/entry', element: <Form to="/wards/5" /> },
    { path: '/zp/:wardId', element: page('ZP ward') },
    { path: '/zp/:wardId/booths/:boothId/entry', element: <Form to="/zp/7" /> },
    { path: '/entries/:entryId/edit', element: <EditLike /> },
    { path: '/candidates', element: page('candidates') },
  ];
  router = createMemoryRouter(
    [
      withShell
        ? { element: <RequireRole roles={['PS_RO', 'ZP_RO', 'DM']} />, children }
        : {
            element: (
              <RoTabsProvider>
                <RoTabs placement="bar" />
                <Outlet />
              </RoTabsProvider>
            ),
            children,
          },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const selected = () =>
  screen
    .getAllByRole('tab')
    .filter((t) => t.getAttribute('aria-selected') === 'true')
    .map((t) => t.textContent);

describe('which tab is active', () => {
  it('from the URL: list tab, PS ward and its entry, ZP ward and its entry, ZP postal', () => {
    expect(ballotOfPath('/wards', '')).toBe('PS');
    expect(ballotOfPath('/wards', '?ballot=ZP')).toBe('ZP');
    expect(ballotOfPath('/wards/5', '')).toBe('PS');
    expect(ballotOfPath('/wards/5/booths/9/entry', '')).toBe('PS');
    expect(ballotOfPath('/zp/7', '')).toBe('ZP');
    expect(ballotOfPath('/zp/7/booths/9/entry', '')).toBe('ZP');
    expect(ballotOfPath('/zp-postal/7', '')).toBe('ZP');
    expect(ballotOfPath('/entries/3/edit', '')).toBeNull();
  });

  it.each([
    ['/wards', 'पंचायत समिति'],
    ['/wards?ballot=ZP', 'जिला परिषद'],
    ['/wards/5/booths/9/entry', 'पंचायत समिति'],
    ['/zp/7/booths/9/entry', 'जिला परिषद'],
    ['/entries/3/edit', 'जिला परिषद'], // the page reports its entry's ballot
  ])('%s -> %s', async (url, tab) => {
    renderAt(url);
    await waitFor(() => {
      expect(selected()).toEqual([tab]);
    });
  });

  it('a page outside both lists (candidates): no tab is active, both stay reachable', () => {
    renderAt('/candidates');
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(selected()).toEqual([]);
  });
});

describe('who sees the tabs (page shell)', () => {
  it.each([
    ['PS_RO', 2],
    ['ZP_RO', 0],
    ['DM', 0],
  ] as const)('%s: %i tabs', async (role, n) => {
    auth.role = role;
    renderAt('/wards/5', true);
    expect(await screen.findByText('PS ward')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(n);
    auth.role = 'PS_RO';
  });
});

describe('wide screens: the tabs are in the header row', () => {
  it('PS_RO: tabs inside the header (sticky), no separate bar, no duplicate "मेरे वार्ड" link', async () => {
    const wide = vi.fn(() => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    vi.stubGlobal('matchMedia', wide);
    try {
      renderAt('/zp/7', true);
      expect(await screen.findByText('ZP ward')).toBeTruthy();
      const header = screen.getByRole('banner');
      expect(header.className).toContain('topbar-sticky');
      expect(header.querySelectorAll('[role="tab"]')).toHaveLength(2);
      expect(screen.getAllByRole('tab')).toHaveLength(2);
      expect(selected()).toEqual(['जिला परिषद']);
      expect(screen.queryByRole('link', { name: 'मेरे वार्ड' })).toBeNull();
      expect(screen.getByRole('link', { name: 'उम्मीदवार' })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('switching and the leave check', () => {
  it('a click goes straight to that list', async () => {
    const r = renderAt('/zp/7');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'पंचायत समिति' }));
    expect(r.state.location.pathname).toBe('/wards');
    expect(r.state.location.search).toBe('');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'जिला परिषद' }));
    expect(r.state.location.search).toBe('?ballot=ZP');
  });

  it('nothing typed: no question', async () => {
    const r = renderAt('/zp/7/booths/9/entry');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'पंचायत समिति' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(r.state.location.pathname).toBe('/wards');
  });

  it('typed: asks; रुकें (focused, also Esc) keeps the value; छोड़कर जाएँ leaves', async () => {
    const user = userEvent.setup();
    const r = renderAt('/zp/7/booths/9/entry');
    await user.type(screen.getByLabelText('मत'), '12');
    await user.click(screen.getByRole('tab', { name: 'पंचायत समिति' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'क्या आप सच में जाना चाहते हैं?' });
    expect(dialog.textContent).toContain('सेव नहीं की गई जानकारी खो जाएगी।');
    const buttons = screen.getAllByRole('button').filter((b) => dialog.contains(b));
    expect(buttons.map((b) => b.textContent)).toEqual(['रुकें', 'छोड़कर जाएँ']);
    await user.click(screen.getByRole('button', { name: 'रुकें' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('मत').value).toBe('12');
    expect(r.state.location.pathname).toBe('/zp/7/booths/9/entry');
    await user.click(screen.getByRole('tab', { name: 'पंचायत समिति' }));
    await user.click(await screen.findByRole('button', { name: 'छोड़कर जाएँ' }));
    expect(r.state.location.pathname).toBe('/wards');
  });

  it('after a save: no question, the form goes where it saves to', async () => {
    const user = userEvent.setup();
    const r = renderAt('/wards/5/booths/9/entry');
    await user.type(screen.getByLabelText('मत'), '7');
    await user.click(screen.getByRole('button', { name: 'सेव' }));
    expect(r.state.location.pathname).toBe('/wards/5');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('the browser warning on reload / close only while typed', async () => {
    const user = userEvent.setup();
    renderAt('/wards/5/booths/9/entry');
    const ask = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(ask()).toBe(false);
    await user.type(screen.getByLabelText('मत'), '3');
    expect(ask()).toBe(true);
  });
});
