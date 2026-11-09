// A business's public page with several places (spec 0065 H7, AC-6593), in Chromium with the app's stylesheet and
// the page's read answered by hand: at the business's own address Reserve asks which place first, a menu of the places
// each opening its own reservation page, and the address stays the business's own; at a place's address it goes
// straight there. With `VITE_SHOT_DIR` set, it keeps the pictures at 1280 and 390, light and dark.
import '@crm/ui/styles.css';
import type { PublicBusinessPage } from '@crm/data/business-page';
import { BookingProvider } from '@crm/ui/public-booking';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, resetTheme, THEMES } from '../../testing/axe.ts';
import { BusinessPublicPage } from './BusinessPublicPage.tsx';

const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  resetTheme();
  vi.restoreAllMocks();
});

const WEEK = {
  weekly: {
    mon: [{ from: '12:00', to: '23:00' }],
    tue: [{ from: '12:00', to: '23:00' }],
    wed: [{ from: '12:00', to: '23:00' }],
    thu: [{ from: '12:00', to: '23:00' }],
    fri: [{ from: '12:00', to: '23:30' }],
    sat: [{ from: '11:00', to: '23:30' }],
    sun: [{ from: '11:00', to: '22:00' }],
  },
  exceptions: [],
};

const PLACE = (id: string, slug: string, name: string, addressLine: string) => ({
  id,
  slug,
  name,
  addressLine,
  city: 'Bengaluru',
  postcode: '560001',
  country: 'IN',
  phone: '+91 80 4567 8901',
  timeZone: 'Asia/Kolkata',
  hours: WEEK,
  seoHidden: false,
});

const HARBOUR = '01900000-0000-7000-8000-0000000000a1';
const PIER = '01900000-0000-7000-8000-0000000000a2';

const BUSINESS: PublicBusinessPage = {
  handle: 'harbour-bar',
  name: 'Harbour Bar',
  kind: 'bar',
  description: 'Small plates and cocktails by the water.',
  gallery: [],
  amenities: ['outdoor', 'wifi'],
  places: [PLACE(HARBOUR, 'harbour', 'Harbour', '1 Church Street'), PLACE(PIER, 'pier', 'Pier', '14 Lavelle Road')],
  placeId: HARBOUR,
  reserve: 'open',
  reservePlaces: [
    { id: HARBOUR, name: 'Harbour', path: '/r/AbCdEfGhIjKlMnOp' },
    { id: PIER, name: 'Pier', path: '/r/QrStUvWxYzAbCdEf' },
  ],
  indexable: true,
  publishedAt: '2026-11-09T10:00:00.000Z',
  tags: [],
};

const moved: string[] = [];

/** The page drawn from the shell's copy; its own read answers the same page. */
function show(initial: PublicBusinessPage, slug?: string) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(initial), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
  host = document.createElement('div');
  document.body.append(host);
  const made = createRoot(host);
  root = made;
  act(() => {
    made.render(
      <BookingProvider locale="en-IN" timeZone="Asia/Kolkata">
        <BusinessPublicPage
          handle={initial.handle}
          {...(slug === undefined ? {} : { slug })}
          initial={initial}
          onMoved={(path) => moved.push(path)}
        />
      </BookingProvider>,
    );
  });
}

async function settle() {
  const ending = document
    .getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY);
  await Promise.all(ending.map((animation) => animation.finished.catch(() => undefined)));
}

async function shoot(name: string) {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  await settle();
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` } as never);
}

describe('a business with several places (AC-6593)', () => {
  it('asks which place Reserve is for at the business’s own address, and stays there', async () => {
    moved.length = 0;
    await page.viewport(1280, 900);
    show(BUSINESS);
    const panel = page.getByRole('complementary');
    await userEvent.click(panel.getByRole('button', { name: 'Reserve a table' }));
    await expect.element(page.getByRole('menuitem', { name: 'Pier' })).toHaveAttribute('href', '/r/QrStUvWxYzAbCdEf');
    // The business's own address is the business's page: it never moves to its first place's.
    expect(moved.filter((path) => path !== globalThis.location.pathname)).not.toContain('/harbour-bar/harbour');
    await userEvent.keyboard('{Escape}');
  });

  it('reserves straight at a place from the place’s own address', async () => {
    await page.viewport(1280, 900);
    const { reservePlaces: _places, ...rest } = BUSINESS;
    show({ ...rest, placeId: PIER, reservePath: '/r/QrStUvWxYzAbCdEf' }, 'pier');
    const panel = page.getByRole('complementary');
    await expect
      .element(panel.getByRole('link', { name: 'Reserve a table' }))
      .toHaveAttribute('href', '/r/QrStUvWxYzAbCdEf');
  });

  it.skipIf(SHOT_DIR === undefined || SHOT_DIR === '')('keeps the pictures', async () => {
    for (const width of [1280, 390]) {
      for (const theme of THEMES) {
        await page.viewport(width, width === 1280 ? 900 : 844);
        applyTheme(theme);
        // A guest page follows the visitor's own scheme, or the look's pin: the pin draws each side here.
        show({ ...BUSINESS, scheme: theme });
        await expect.element(page.getByRole('heading', { level: 1, name: 'Harbour Bar' })).toBeVisible();
        await shoot(`public-page-${theme}-${String(width)}`);
        const reserve =
          width === 1280
            ? page.getByRole('complementary').getByRole('button', { name: 'Reserve a table' })
            : page.getByRole('button', { name: 'Reserve a table' }).last();
        await userEvent.click(reserve);
        await expect.element(page.getByRole('menuitem', { name: 'Pier' })).toBeVisible();
        await shoot(`public-reserve-${theme}-${String(width)}`);
        await userEvent.keyboard('{Escape}');
        act(() => root?.unmount());
        host?.remove();
        root = undefined;
        vi.restoreAllMocks();
      }
    }
  });
});
