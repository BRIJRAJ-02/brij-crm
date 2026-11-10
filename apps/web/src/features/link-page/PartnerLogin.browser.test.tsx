// A connected app's person's own Timefix login (spec 0070, AC-7023) in Chromium with a fake data layer: Team pages
// offers Set up their Timefix login on an app's person's row (with Members' invite permission in the app, or to the
// app's admin inside its frame), sends it and revokes it through the login calls; the person's own card inside the
// frame sets one up, shows it sent, and draws nothing once they have one. axe is clean in light and dark. With
// VITE_SHOT_DIR set, each state is photographed there at 1280 and 390, light and dark, the card also in the overview it
// sits under.
import '@crm/ui/styles.css';
import type { DataLayer, LinkPageStore, MyTimefixLogin, TeamLinkPage } from '@crm/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { openDialog, renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { LinkPageOverview } from './LinkPageOverview.tsx';
import { EmbeddedLinkPages } from './place.tsx';
import { TeamPagesScreen } from './TeamPagesScreen.tsx';
import { TimefixLoginCard } from './TimefixLoginCard.tsx';

const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;
const MANAGE = ['link_pages.manage_team'];
const BOTH = ['link_pages.manage_team', 'members.invite'];
const GRACE = '0192f0c8-7d2a-7000-8000-00000000a002';

const PAGES: readonly TeamLinkPage[] = [
  {
    memberId: '0192f0c8-7d2a-7000-8000-00000000a001',
    name: 'Ada Lovelace',
    handle: 'ada',
    isLive: true,
    views: 214,
    isSelf: true,
  },
  {
    memberId: GRACE,
    name: 'Grace Hopper',
    handle: 'grace',
    isLive: true,
    views: 88,
    isSelf: false,
    isFromApp: true,
    email: 'grace@hub.example',
  },
  {
    memberId: '0192f0c8-7d2a-7000-8000-00000000a003',
    name: 'Hal Finney',
    handle: 'hal',
    isLive: false,
    views: 3,
    isSelf: false,
    isFromApp: true,
    hasLogin: true,
  },
];

/** One snapshot, the same each read (a held value's store answers the same object until it changes). */
const loadingNow = { status: 'loading' as const };
const stillLoading = {
  subscribe: () => () => undefined,
  getSnapshot: () => loadingNow,
  retain: () => () => undefined,
};

/** The link page store as the overview reads it: Insights and the code's style, still loading. */
const waiting = { ...stillLoading, retry: () => undefined };
const linkPageStore = {
  reach: {
    insights: () => waiting,
    insightDays: [7, 30, 90],
    qrStyle: () => waiting,
    pictureSrc: (_slug: string, id: string) => `/api/profile/images/${id}`,
    insightsCsvHref: () => '/api/profile/insights.csv',
  },
} as unknown as LinkPageStore;

/** A pause for a dialog's entrance to settle before it is photographed. */
const settled = () => new Promise((done) => setTimeout(done, 400));

let shown: InApp | undefined;

function clear() {
  shown?.unmount();
  shown = undefined;
  resetTheme();
}

afterEach(clear);

const sentInvite = (email: string) => ({
  invite: { email, sentAt: '2026-11-10T10:00:00.000Z', expiresAt: '2026-11-17T10:00:00.000Z' },
  sent: true,
});

/** The fake layer: Team pages' list, and the login calls. */
function layerWith(
  mine: MyTimefixLogin = { canSetUp: true, hasLogin: false, memberId: GRACE, email: 'grace@hub.example' },
) {
  const inviteLogin = vi.fn((_slug: string, _member: string, email: string) => Promise.resolve(sentInvite(email)));
  const cancelLoginInvite = vi.fn((_slug: string, _member: string) => Promise.resolve({ cancelled: true }));
  const myLogin = vi.fn((_slug: string) => Promise.resolve(mine));
  const data = {
    teamPages: {
      list: () => Promise.resolve({ pages: PAGES, month: '2026-11-01' }),
      inviteLogin,
      cancelLoginInvite,
      myLogin,
      editedBy: () => Promise.resolve({}),
    },
    inbox: { unread: () => stillLoading },
  } as unknown as Partial<DataLayer>;
  return { data, inviteLogin, cancelLoginInvite, myLogin };
}

async function renderTeam(data: Partial<DataLayer>, permissions: readonly string[], inFrame = false) {
  shown = await renderInApp(
    () =>
      inFrame ? (
        <EmbeddedLinkPages
          place={{ base: '/embed/hub/link-page', canManageTeam: true, workspaceName: 'Acme', appName: 'Hub' }}
        >
          <TeamPagesScreen data={data as DataLayer} slug="acme" />
        </EmbeddedLinkPages>
      ) : (
        <TeamPagesScreen data={data as DataLayer} slug="acme" />
      ),
    { data, pattern: '/w/$slug/link-page', at: '/w/acme/link-page?team=true', permissions },
  );
}

async function renderCard(data: Partial<DataLayer>) {
  shown = await renderInApp(() => <TimefixLoginCard data={data as DataLayer} slug="acme" appName="Hub" />, {
    data,
    pattern: '/embed/$clientId/link-page',
    at: '/embed/hub/link-page',
  });
}

async function shot(name: string) {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

describe('Set up their Timefix login, on Team pages', () => {
  it('is offered on an app’s person’s row only with Members’ invite permission, never to one who has a login', async () => {
    await renderTeam(layerWith().data, MANAGE);
    await userEvent.click(page.getByRole('button', { name: 'Actions for Grace Hopper' }));
    await expect.element(page.getByRole('menuitem', { name: 'Edit page' })).toBeVisible();
    expect(document.body.textContent).not.toContain('Set up their Timefix login');
    clear();
    await renderTeam(layerWith().data, BOTH);
    await userEvent.click(page.getByRole('button', { name: 'Actions for Hal Finney' }));
    await expect.element(page.getByRole('menuitem', { name: 'Edit page' })).toBeVisible();
    expect(document.body.textContent).not.toContain('Set up their Timefix login');
  });

  it('sends it from the address the app gave, marks the row Invited, and revokes it after a confirm', async () => {
    const { data, inviteLogin, cancelLoginInvite } = layerWith();
    await renderTeam(data, BOTH);
    await userEvent.click(page.getByRole('button', { name: 'Actions for Grace Hopper' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Set up their Timefix login' }));
    await expect.element(page.getByRole('dialog', { name: 'Set up a Timefix login for Grace' })).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toHaveValue('grace@hub.example');
    // Once the dialog's entrance has played (mid fade, its text is lighter than it settles).
    for (const theme of THEMES) {
      applyTheme(theme);
      await vi.waitFor(async () => expect(await axeViolations()).toEqual([]), { timeout: 2000 });
    }
    await userEvent.click(page.getByRole('button', { name: 'Send invitation' }));
    await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
    expect(inviteLogin).toHaveBeenCalledWith('acme', GRACE, 'grace@hub.example');
    await expect.element(page.getByRole('rowheader', { name: /Grace Hopper.*Invited/ })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Actions for Grace Hopper' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Revoke invitation' }));
    await expect.element(page.getByRole('alertdialog')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Revoke invitation' }));
    await vi.waitFor(() => expect(cancelLoginInvite).toHaveBeenCalledWith('acme', GRACE));
  });

  it('is the app’s admin’s inside the app’s frame, naming the app', async () => {
    await renderTeam(layerWith().data, [], true);
    await userEvent.click(page.getByRole('button', { name: 'Actions for Grace Hopper' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Set up their Timefix login' }));
    await expect.element(page.getByText(/They keep using Hub, and can also sign in to Timefix/)).toBeVisible();
  });
});

describe('the person’s own Timefix login card, inside the app’s frame', () => {
  it('sets one up, then says it went and offers to send again or cancel', async () => {
    const { data, inviteLogin, cancelLoginInvite } = layerWith();
    await renderCard(data);
    await expect
      .element(page.getByText('Keep using Hub as before. You can also sign in to Timefix directly.'))
      .toBeVisible();
    for (const theme of THEMES) {
      applyTheme(theme);
      expect(await axeViolations()).toEqual([]);
    }
    await userEvent.click(page.getByRole('button', { name: 'Set up your Timefix login' }));
    await expect.element(page.getByRole('dialog', { name: 'Set up your Timefix login' })).toBeVisible();
    await userEvent.fill(page.getByRole('textbox', { name: 'Email' }), 'grace@personal.example');
    await userEvent.click(page.getByRole('button', { name: 'Email me the link' }));
    await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
    expect(inviteLogin).toHaveBeenCalledWith('acme', GRACE, 'grace@personal.example');
    await expect.element(page.getByText(/Invitation sent to grace@personal\.example\. Open the link/)).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Revoke invitation' }));
    await expect.element(page.getByRole('alertdialog', { name: 'Revoke your invitation?' })).toBeVisible();
    await expect.element(page.getByText(/The link sent to grace@personal\.example stops working/)).toBeVisible();
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Revoke invitation' }));
    await vi.waitFor(() => expect(cancelLoginInvite).toHaveBeenCalledWith('acme', GRACE));
    await expect.element(page.getByRole('button', { name: 'Set up your Timefix login' })).toBeVisible();
  });

  it('draws nothing once they have a login, or for someone who can’t set one up', async () => {
    for (const mine of [
      { canSetUp: false, hasLogin: true, memberId: GRACE },
      { canSetUp: false, hasLogin: false, memberId: GRACE },
    ]) {
      const { data, myLogin } = layerWith(mine);
      await renderCard(data);
      await vi.waitFor(() => expect(myLogin).toHaveBeenCalled());
      expect(document.body.textContent).not.toContain('Timefix login');
      clear();
    }
  });
});

describe('pictures', () => {
  it.runIf(SHOT_DIR !== undefined && SHOT_DIR !== '')(
    'photographs each state at 1280 and 390, light and dark',
    async () => {
      for (const [width, height] of [
        [1280, 860],
        [390, 844],
      ] as const) {
        await page.viewport(width, height);
        for (const theme of THEMES) {
          const at = `${String(width)}-${theme}`;
          await renderTeam(layerWith().data, BOTH);
          applyTheme(theme);
          await userEvent.click(page.getByRole('button', { name: 'Actions for Grace Hopper' }));
          await expect.element(page.getByRole('menuitem', { name: 'Set up their Timefix login' })).toBeVisible();
          await settled();
          await shot(`team-menu-${at}`);
          await userEvent.click(page.getByRole('menuitem', { name: 'Set up their Timefix login' }));
          await expect.element(page.getByRole('dialog')).toBeVisible();
          await settled();
          await shot(`team-dialog-${at}`);
          await userEvent.click(page.getByRole('button', { name: 'Send invitation' }));
          await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
          await shot(`team-invited-${at}`);
          clear();

          // The card where it sits: under the person's own page card, inside the app's frame.
          const { data } = layerWith();
          shown = await renderInApp(
            () => (
              <EmbeddedLinkPages
                place={{ base: '/embed/hub/link-page', canManageTeam: false, workspaceName: 'Acme', appName: 'Hub' }}
              >
                <main>
                  <LinkPageOverview
                    slug="acme"
                    handle="grace"
                    address="https://timefix.com/grace"
                    isPublic
                    isEmpty={false}
                    onEdit={() => undefined}
                    onAdd={() => undefined}
                    onGoLive={() => undefined}
                    linkPage={linkPageStore}
                    items={[]}
                    login={<TimefixLoginCard data={data as DataLayer} slug="acme" appName="Hub" />}
                  />
                </main>
              </EmbeddedLinkPages>
            ),
            { data, pattern: '/embed/$clientId/link-page', at: '/embed/hub/link-page' },
          );
          applyTheme(theme);
          await expect.element(page.getByRole('button', { name: 'Set up your Timefix login' })).toBeVisible();
          await shot(`own-card-${at}`);
          await userEvent.click(page.getByRole('button', { name: 'Set up your Timefix login' }));
          await expect.element(page.getByRole('dialog')).toBeVisible();
          await settled();
          await shot(`own-dialog-${at}`);
          await userEvent.click(page.getByRole('button', { name: 'Email me the link' }));
          await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
          await shot(`own-invited-${at}`);
          await userEvent.click(page.getByRole('button', { name: 'Revoke invitation' }));
          await expect.element(page.getByRole('alertdialog')).toBeVisible();
          await settled();
          await shot(`own-revoke-${at}`);
          clear();
        }
      }
    },
    180_000,
  );
});
