// The link page editor's spec 0061 pieces in Chromium (R4): Insights with its figures readable as tables and its
// empty line (AC-6118), the CSV's address (AC-6120), ready links per place and the builder (AC-6125), a tile's size
// picked by sight (AC-6103), and a full new kind off in the Add grid (AC-6115).
import '@crm/ui/styles.css';
import type { DataLayer, InsightsState, LinkPageStore, ProfileCounts } from '@crm/data';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { SizePicker } from './block-extras.tsx';
import { Insights } from './Insights.tsx';
import { KindPicker } from './KindPicker.tsx';
import { markedAddress, ShareLinksModal } from './ShareTools.tsx';

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

async function render(screen: () => ReactNode) {
  shown = await renderInApp(() => <main>{screen()}</main>, {
    data: {} as Partial<DataLayer>,
    pattern: '/w/$slug/link-page',
    at: '/w/acme/link-page',
  });
}

/** A store whose Insights answer `state` for every period, and say which period was asked for. */
function storeAnswering(state: InsightsState, asked: (days: number) => void = () => undefined): LinkPageStore {
  return {
    reach: {
      insights: (_slug: string, days: number) => {
        asked(days);
        return {
          subscribe: () => () => undefined,
          getSnapshot: () => state,
          retain: () => () => undefined,
          retry: () => undefined,
        };
      },
      insightDays: [7, 30, 90],
      insightsCsvHref: (slug: string, from: string, to: string) =>
        `/api/profile/insights.csv?workspace=${slug}&from=${from}&to=${to}`,
    },
  } as unknown as LinkPageStore;
}

const COUNTS: ProfileCounts = {
  days: 30,
  views: 40,
  visitors: 25,
  before: { views: 20, visitors: 20 },
  presses: [{ id: '0192f0c8-7d2a-7000-8000-000000000001', presses: 6 }],
  series: Array.from({ length: 30 }, (_, at) => ({
    day: `2026-10-${String(at + 1).padStart(2, '0')}`,
    views: at % 3,
    visitors: at % 2,
  })),
  facts: {
    referrer: [
      { value: 'instagram.com', views: 30, visitors: 20 },
      { value: 'Direct', views: 10, visitors: 5 },
    ],
    source: [{ value: 'ig_bio', views: 12, visitors: 9 }],
    country: [{ value: 'IN', views: 40, visitors: 25 }],
    device: [{ value: 'mobile', views: 40, visitors: 25 }],
  },
  funnel: { views: 40, presses: 6, bookings: 1 },
};

describe('Insights (AC-6118, AC-6119, AC-6120)', () => {
  it('shows the period’s figures against the one before, each fact as a table, and the CSV for the period', async () => {
    const asked = vi.fn();
    const items = [
      {
        kind: 'link' as const,
        id: '0192f0c8-7d2a-7000-8000-000000000001',
        title: 'Shop',
        url: 'https://shop.dev',
        hue: 'blue' as const,
        updatedAt: '',
      },
    ];
    await render(() => (
      <Insights linkPage={storeAnswering({ status: 'ready', counts: COUNTS }, asked)} slug="acme" items={items} />
    ));
    await expect.element(page.getByText(/20 in the 30.days before/).first()).toBeVisible();
    // The sites, as a table a screen reader reads, Direct by its own word.
    const sites = page.getByRole('grid', { name: 'Sites' });
    await expect.element(sites.getByRole('rowheader', { name: 'instagram.com' })).toBeVisible();
    await expect.element(sites.getByRole('rowheader', { name: 'Direct' })).toBeVisible();
    // Another fact, picked from the keyboard; a country reads by its name.
    (page.getByRole('radio', { name: 'Sites' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    await expect.element(page.getByRole('grid', { name: 'Countries' }).getByText('India')).toBeVisible();
    // Each block's clicks, by its title.
    await expect.element(page.getByRole('grid', { name: 'Clicks by block' }).getByText('Shop')).toBeVisible();
    // The funnel: clicks as a share of views, bookings as a share of clicks.
    await expect.element(page.getByText('15% of views')).toBeVisible();
    await expect.element(page.getByText('17% of clicks')).toBeVisible();
    const csv = page.getByRole('link', { name: 'Download CSV' });
    await expect
      .element(csv)
      .toHaveAttribute('href', expect.stringContaining('/api/profile/insights.csv?workspace=acme'));
    await expect.element(csv).toHaveAttribute('download');
    (page.getByRole('radio', { name: '30 days' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(asked).toHaveBeenLastCalledWith(90);
  });

  it('says how to get visits while there are none', async () => {
    const none: ProfileCounts = { days: 30, views: 0, visitors: 0, before: { views: 0, visitors: 0 }, presses: [] };
    await render(() => (
      <Insights linkPage={storeAnswering({ status: 'ready', counts: none })} slug="acme" items={[]} />
    ));
    await expect.element(page.getByText('No visits yet')).toBeVisible();
    await expect.element(page.getByText('Share your page to see where people come from.')).toBeVisible();
    expect(page.getByRole('link', { name: 'Download CSV' }).query()).toBeNull();
  });
});

describe('links for each place (AC-6125)', () => {
  it('marks each place’s link with its source and medium, and builds one from three checked words', async () => {
    expect(markedAddress('https://timefix.com/ada', { source: 'instagram', medium: 'social' })).toBe(
      'https://timefix.com/ada?utm_source=instagram&utm_medium=social',
    );
    await render(() => <ShareLinksModal address="https://timefix.com/ada" isOpen onClose={() => undefined} />);
    await expect
      .element(page.getByRole('textbox', { name: 'Instagram' }))
      .toHaveValue('timefix.com/ada?utm_source=instagram&utm_medium=social');
    await expect
      .element(page.getByRole('textbox', { name: 'QR code' }))
      .toHaveValue('timefix.com/ada?utm_source=qr&utm_medium=print');
    const source = page.getByRole('textbox', { name: 'Source' });
    await source.fill('news letter');
    await expect.element(source).toHaveAccessibleDescription(/Use letters, numbers/);
    expect(page.getByRole('textbox', { name: 'Your link' }).query()).toBeNull();
    await source.fill('Newsletter');
    await page.getByRole('textbox', { name: 'Campaign' }).fill('spring');
    await expect
      .element(page.getByRole('textbox', { name: 'Your link' }))
      .toHaveValue('timefix.com/ada?utm_source=newsletter&utm_campaign=spring');
  });
});

describe('a tile’s size and a full kind (AC-6103, AC-6115)', () => {
  it('picks a size by sight from the keyboard', async () => {
    const onChange = vi.fn();
    await render(() => <SizePicker value="small" onChange={onChange} />);
    const sizes = page.getByRole('radiogroup', { name: 'Size on a grid' });
    await expect.element(sizes.getByRole('radio', { name: 'Small' })).toBeChecked();
    (sizes.getByRole('radio', { name: 'Small' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('wide');
  });

  it('turns a full new kind off in the Add grid with its sentence', async () => {
    await render(() => (
      <KindPicker
        value="link"
        fullReason={(kind) => (kind === 'socials' ? 'A link page holds one row of social links.' : undefined)}
        onChange={() => undefined}
      />
    ));
    const tile = page.getByRole('radio', { name: 'Social icons' });
    await expect.element(tile).toBeDisabled();
    await expect.element(tile).toHaveAccessibleDescription('A link page holds one row of social links.');
    await expect.element(page.getByRole('radio', { name: 'Video or music' })).toBeEnabled();
  });
});
