// A page's flow rule cards, in Chromium (spec 0062, L1): one-time links (made once with their address to copy,
// revoked behind a confirm) and requests (Confirm, Decline with a reason behind a confirm), with no axe violations in
// either theme.
import '@crm/ui/styles.css';
import type { BookingPageView, BookingRequestView, DataLayer, OneOffLinkView } from '@crm/data';
import { PageColumn } from '@crm/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { OneOffLinksCard } from './OneOffLinksCard.tsx';
import { RequestsCard } from './RequestsCard.tsx';

const LINK: OneOffLinkView = {
  id: '0192f0a0-0000-7000-8000-000000000001',
  label: 'For Grace',
  maxUses: 3,
  uses: 1,
  expiresAt: '2026-12-01T00:00:00.000Z',
  state: 'open',
  createdAt: '2026-11-01T00:00:00.000Z',
};
const REQUEST: BookingRequestView = {
  bookingId: '0192f0a0-0000-7000-8000-000000000002',
  start: '2026-11-09T09:00:00.000Z',
  end: '2026-11-09T09:30:00.000Z',
  visitorName: 'Grace Hopper',
  visitorEmail: 'grace@navy.example',
  expiresAt: '2026-11-08T09:00:00.000Z',
};

/** The page the links card belongs to: only its id and links only setting are read. */
const PAGE = { id: 'page', linksOnly: false } as unknown as BookingPageView;

let shown: InApp | undefined;
afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

function flow() {
  return {
    links: vi.fn(() => Promise.resolve([LINK])),
    createLink: vi.fn(() => Promise.resolve({ link: LINK, token: 't'.repeat(43) })),
    revokeLink: vi.fn(() => Promise.resolve({ ...LINK, state: 'revoked' as const })),
    requests: vi.fn(() => Promise.resolve([REQUEST])),
    confirm: vi.fn(() => Promise.resolve(true)),
    decline: vi.fn(() => Promise.resolve(true)),
  };
}

/** The page writes the links card makes: Book only through these links goes into the page's draft (spec 0068). */
function pages() {
  return {
    saveDraft: vi.fn(() => Promise.resolve({ ...PAGE, linksOnly: true })),
    update: vi.fn(() => Promise.resolve({ ...PAGE, linksOnly: true })),
  };
}

async function show(bookingFlow: ReturnType<typeof flow>, bookingPages = pages()) {
  const data = { bookingFlow, bookingPages } as unknown as DataLayer;
  shown = await renderInApp(
    () => (
      <PageColumn>
        <RequestsCard data={data} slug="acme" pageId="page" isReadOnly={false} />
        <OneOffLinksCard
          data={data}
          slug="acme"
          page={PAGE}
          pageUrl="https://timefix.com/b/abc"
          isReadOnly={false}
          onSaved={() => undefined}
        />
      </PageColumn>
    ),
    {
      data: { bookingFlow, bookingPages } as unknown as Partial<DataLayer>,
      pattern: '/w/$slug/bookings/links/$id',
      at: '/w/acme/bookings/links/one',
    },
  );
}

describe('one-time links', () => {
  it('lists a link with its uses left, and makes one whose address is shown once with its token', async () => {
    const bookingFlow = flow();
    await show(bookingFlow);
    await expect.element(page.getByText('2 of 3 left')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'New link' }));
    await userEvent.fill(page.getByRole('textbox', { name: 'Label' }), 'For Ann');
    await userEvent.click(page.getByRole('button', { name: 'Make link' }));
    expect(bookingFlow.createLink).toHaveBeenCalledWith('acme', { pageId: 'page', maxUses: 1, label: 'For Ann' });
    await expect
      .element(page.getByRole('textbox', { name: 'One-time links' }))
      .toHaveValue(`https://timefix.com/b/abc#o=${'t'.repeat(43)}`);
  });

  it('revokes a link only after its confirm', async () => {
    const bookingFlow = flow();
    await show(bookingFlow);
    await userEvent.click(page.getByRole('button', { name: 'Revoke' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Revoke' }));
    expect(bookingFlow.revokeLink).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }));
    expect(bookingFlow.revokeLink).toHaveBeenCalledWith('acme', 'page', LINK.id);
  });
});

describe('book only through these links', () => {
  it('goes into the page’s draft for Publish, never straight to guests (spec 0068, AC-6810)', async () => {
    const bookingPages = pages();
    await show(flow(), bookingPages);
    await userEvent.click(page.getByText('Book only through these links'));
    await expect.poll(() => bookingPages.saveDraft.mock.calls.length).toBe(1);
    expect(bookingPages.saveDraft).toHaveBeenCalledWith('acme', 'page', { linksOnly: true });
    expect(bookingPages.update).not.toHaveBeenCalled();
  });
});

describe('requests', () => {
  it('confirms one at once, and declines one with its reason after a confirm', async () => {
    const bookingFlow = flow();
    await show(bookingFlow);
    await userEvent.click(page.getByRole('button', { name: 'Confirm', exact: true }));
    expect(bookingFlow.confirm).toHaveBeenCalledWith('acme', REQUEST.bookingId);
    await userEvent.click(page.getByRole('button', { name: 'Decline', exact: true }));
    await userEvent.fill(page.getByRole('textbox', { name: 'Reason (optional)' }), 'Away that day');
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Decline' }));
    expect(bookingFlow.decline).toHaveBeenCalledWith('acme', REQUEST.bookingId, 'Away that day');
  });
});

describe('both cards', () => {
  it.each(THEMES)('have no axe violations in %s', async (theme) => {
    await show(flow());
    await expect.element(page.getByText('2 of 3 left')).toBeVisible();
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });

  it.runIf(import.meta.env.VITE_FLOW_SHOTS === '1')('save screenshots at 390 and 1280, light and dark', async () => {
    for (const width of [390, 1280]) {
      for (const theme of THEMES) {
        await page.viewport(width, 900);
        await show(flow());
        await expect.element(page.getByText('2 of 3 left')).toBeVisible();
        applyTheme(theme);
        await page.screenshot({ path: `flow-shots/cards-${String(width)}-${theme}.png` });
        shown?.unmount();
        shown = undefined;
        resetTheme();
      }
    }
  });
});
