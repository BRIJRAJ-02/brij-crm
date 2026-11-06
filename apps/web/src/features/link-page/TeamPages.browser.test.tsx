// Team pages (spec 0070, slice 1) in Chromium with a fake data layer: everyone's page with its handle, Live or
// Private and this month's views (AC-7001), a handle claimed for someone with none (AC-7002), each page's QR codes
// (AC-7003), the refusal for someone who may not manage them, axe in both themes, and "Edited by" on the person's own
// page (AC-7004). With `VITE_TEAM_SHOTS=1` it saves the screens at 1280 and 390, light and dark, for the lane's eyes.
import '@crm/ui/styles.css';
import type { DataLayer, InsightsState, LinkPageStore, QrStyleState, TeamLinkPage } from '@crm/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { openDialog, renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { LinkPageOverview } from './LinkPageOverview.tsx';
import { TeamPagesScreen } from './TeamPagesScreen.tsx';

// Beside this file (the test server writes only inside the project); the lane moves them out and never commits them.
const SHOTS = 'team-shots';
const MANAGE = ['link_pages.manage_team'];

const PAGES: readonly TeamLinkPage[] = [
  {
    memberId: '0192f0c8-7d2a-7000-8000-000000000001',
    name: 'Ada Lovelace',
    handle: 'ada',
    isLive: true,
    views: 214,
    isSelf: true,
  },
  {
    memberId: '0192f0c8-7d2a-7000-8000-000000000002',
    name: 'Bea Rao',
    handle: 'bea-rao',
    isLive: true,
    views: 1280,
    isSelf: false,
  },
  {
    memberId: '0192f0c8-7d2a-7000-8000-000000000003',
    name: 'Cy Okafor',
    handle: 'cy',
    isLive: false,
    views: 0,
    isSelf: false,
  },
  { memberId: '0192f0c8-7d2a-7000-8000-000000000004', name: 'Dee Marsh', isLive: false, views: 0, isSelf: false },
];

const stillLoading = {
  subscribe: () => () => undefined,
  getSnapshot: () => ({ status: 'loading' as const }),
  retain: () => () => undefined,
};

let shown: InApp | undefined;

/** Takes the screen down and the theme off. */
function clear() {
  shown?.unmount();
  shown = undefined;
  resetTheme();
}

afterEach(clear);

/** The fake layer: the list as given (or a refusal), and a claim that answers the claimed row. */
function layerWith(list: () => Promise<{ pages: readonly TeamLinkPage[]; month: string }>) {
  const claim = vi.fn((_slug: string, member: string, handle: string) => {
    const found = PAGES.find((each) => each.memberId === member);
    return found === undefined
      ? Promise.reject(new Error('Nobody'))
      : Promise.resolve({ ...found, handle, isLive: false });
  });
  const data = {
    teamPages: { list, claim, editedBy: () => Promise.resolve({}) },
    inbox: { unread: () => stillLoading },
  } as unknown as Partial<DataLayer>;
  return { data, claim };
}

async function renderTeam(data: Partial<DataLayer>, permissions: readonly string[] = MANAGE) {
  shown = await renderInApp(() => <TeamPagesScreen data={data as DataLayer} slug="acme" />, {
    data,
    pattern: '/w/$slug/link-page',
    at: '/w/acme/link-page?team=true',
    permissions,
  });
}

const ready = () => Promise.resolve({ pages: PAGES, month: '2026-11-01' });

describe('Team pages (AC-7001)', () => {
  it('lists every person with their handle, Live or Private and this month’s views, and passes axe', async () => {
    await renderTeam(layerWith(ready).data);
    await expect.element(page.getByRole('heading', { level: 1, name: 'Team pages' })).toBeInTheDocument();
    await expect.element(page.getByRole('rowheader', { name: /Bea Rao/ })).toBeVisible();
    const text = document.body.textContent;
    expect(text).toContain('/bea-rao');
    expect(text).toContain('1,280');
    expect(text).toContain('No page yet');
    expect(text).toContain('Private');
    await expect.element(page.getByRole('button', { name: 'Download all QR codes' })).toBeEnabled();
    for (const theme of THEMES) {
      applyTheme(theme);
      expect(await axeViolations()).toEqual([]);
    }
  });

  it('says so, and lists nobody, for someone who may not manage team pages', async () => {
    // A DataError as the layer makes one: an Error named so, with the code.
    const refused = () => Promise.reject(Object.assign(new Error('nope'), { name: 'DataError', code: 'FORBIDDEN' }));
    await renderTeam(layerWith(refused).data, []);
    await expect.element(page.getByText(/Only people who manage the team/)).toBeVisible();
    expect(document.querySelector('[role="grid"], table')).toBeNull();
  });
});

describe('a handle claimed for someone (AC-7002)', () => {
  it('opens the claim from a row with no page, checks the handle first, and shows the claimed row', async () => {
    const { data, claim } = layerWith(ready);
    await renderTeam(data);
    await userEvent.click(page.getByRole('button', { name: 'Actions for Dee Marsh' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Claim handle' }));
    await expect.element(page.getByRole('dialog', { name: /Claim a handle for Dee/ })).toBeVisible();
    // Nothing typed: refused before anything is sent.
    await userEvent.click(page.getByRole('button', { name: 'Claim', exact: true }));
    await expect.element(page.getByText('Add a handle.')).toBeVisible();
    expect(claim).not.toHaveBeenCalled();
    await userEvent.fill(page.getByRole('textbox', { name: 'Handle' }), 'dee');
    await userEvent.click(page.getByRole('button', { name: 'Claim', exact: true }));
    await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
    expect(claim).toHaveBeenCalledWith('acme', PAGES[3]?.memberId, 'dee');
    expect(document.body.textContent).toContain('/dee');
  });
});

describe('QR codes (AC-7003)', () => {
  it('offers PNG and SVG on a page’s row, and nothing to download for a row with no page', async () => {
    await renderTeam(layerWith(ready).data);
    await userEvent.click(page.getByRole('button', { name: 'Actions for Bea Rao' }));
    await expect.element(page.getByRole('menuitem', { name: 'Download QR code (PNG)' })).toBeVisible();
    await expect.element(page.getByRole('menuitem', { name: 'Download QR code (SVG)' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(page.getByRole('button', { name: 'Actions for Dee Marsh' }));
    expect(document.body.textContent).not.toContain('Download QR code (PNG)');
  });
});

/** One snapshot each, the same every read, as a store's must be. */
const PLAIN_QR: QrStyleState = { status: 'ready', style: {}, isSaving: false };
const NO_VISITS: InsightsState = { status: 'loading' };

/** A link page store that answers the overview's two reads: no QR style, and no visits yet. */
const overviewStore = {
  reach: {
    qrStyle: () => ({
      subscribe: () => () => undefined,
      getSnapshot: () => PLAIN_QR,
      retain: () => () => undefined,
      retry: () => undefined,
    }),
    insights: () => ({
      subscribe: () => () => undefined,
      getSnapshot: () => NO_VISITS,
      retain: () => () => undefined,
      retry: () => undefined,
    }),
    insightDays: [7, 30, 90],
    insightsCsvHref: () => '/api/profile/insights.csv',
    pictureSrc: () => '',
  },
} as unknown as LinkPageStore;

async function renderOverview() {
  shown = await renderInApp(
    () => (
      <main>
        <LinkPageOverview
          slug="acme"
          handle="bea-rao"
          address="https://timefix.com/bea-rao"
          isPublic
          isEmpty={false}
          onEdit={() => undefined}
          onAdd={() => undefined}
          onGoLive={() => undefined}
          linkPage={overviewStore}
          items={[]}
          editedBy={{ name: 'Ada Lovelace' }}
        />
      </main>
    ),
    { data: {}, pattern: '/w/$slug/link-page', at: '/w/acme/link-page' },
  );
}

describe('“Edited by” on the person’s own page (AC-7004)', () => {
  it('names who else changed it last', async () => {
    await renderOverview();
    await expect.element(page.getByText(/Edited by Ada Lovelace/)).toBeVisible();
  });
});

describe('screenshots', () => {
  it.runIf(import.meta.env.VITE_TEAM_SHOTS === '1')('saves Team pages at 1280 and 390, light and dark', async () => {
    for (const [width, height] of [
      [1280, 860],
      [390, 844],
    ] as const) {
      await page.viewport(width, height);
      for (const theme of THEMES) {
        await renderTeam(layerWith(ready).data);
        applyTheme(theme);
        await expect.element(page.getByRole('rowheader', { name: /Bea Rao/ })).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/team-${String(width)}-${theme}.png` });
        await userEvent.click(page.getByRole('button', { name: 'Actions for Dee Marsh' }));
        await userEvent.click(page.getByRole('menuitem', { name: 'Claim handle' }));
        await expect.element(page.getByRole('dialog')).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/claim-${String(width)}-${theme}.png` });
        await userEvent.keyboard('{Escape}');
        await userEvent.click(page.getByRole('button', { name: 'Actions for Bea Rao' }));
        await expect.element(page.getByRole('menuitem', { name: 'Download QR code (PNG)' })).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/menu-${String(width)}-${theme}.png` });
        clear();
        await renderOverview();
        applyTheme(theme);
        await expect.element(page.getByText(/Edited by Ada Lovelace/)).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/edited-by-${String(width)}-${theme}.png` });
        clear();
      }
    }
  });
});
