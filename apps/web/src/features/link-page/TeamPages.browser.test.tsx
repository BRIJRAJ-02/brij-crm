// Team pages (spec 0070, slice 1) in Chromium with a fake data layer: everyone's page with its handle, Live or
// Private and this month's views (AC-7001), a handle claimed for someone with none (AC-7002), each page's QR codes
// (AC-7003), the refusal for someone who may not manage them, axe in both themes, and "Edited by" on the person's own
// page (AC-7004); Add a page and Remove person for a page only person (9 Nov 2026). With `VITE_TEAM_SHOTS=1` it saves the screens at 1280 and 390, light and dark, for the lane's eyes.
import '@crm/ui/app.css';
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
/** Handing a page over needs Members' invite permission too. */
const HAND_OVER = ['link_pages.manage_team', 'members.invite'];

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
  {
    memberId: '0192f0c8-7d2a-7000-8000-000000000005',
    name: 'Eve Page',
    handle: 'eve',
    isLive: false,
    views: 0,
    isSelf: false,
    isPageOnly: true,
    email: 'eve@example.com',
  },
];

/** A handle Add a page's check calls taken. */
const TAKEN = 'nick';

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
function layerWith(list: () => Promise<{ pages: readonly TeamLinkPage[]; month: string; hasWallet?: boolean }>) {
  const claim = vi.fn((_slug: string, member: string, handle: string) => {
    const found = PAGES.find((each) => each.memberId === member);
    return found === undefined
      ? Promise.reject(new Error('Nobody'))
      : Promise.resolve({ ...found, handle, isLive: false });
  });
  const addPerson = vi.fn(
    (_slug: string, person: { readonly name: string; readonly email?: string; readonly handle: string }) =>
      Promise.resolve<TeamLinkPage>({
        memberId: '0192f0c8-7d2a-7000-8000-000000000009',
        name: person.name,
        handle: person.handle,
        isLive: false,
        views: 0,
        isSelf: false,
        isPageOnly: true,
      }),
  );
  const removePerson = vi.fn((_slug: string, _member: string) => Promise.resolve({ removed: true }));
  const invitePerson = vi.fn((_slug: string, _member: string, email: string) =>
    Promise.resolve({
      invite: { email, sentAt: '2026-11-09T10:00:00.000Z', expiresAt: '2026-11-16T10:00:00.000Z' },
      sent: true,
    }),
  );
  const cancelInvite = vi.fn((_slug: string, _member: string) => Promise.resolve({ cancelled: true }));
  const checkHandle = vi.fn((_slug: string, handle: string, _signal?: AbortSignal) =>
    Promise.resolve({ isFree: handle !== TAKEN }),
  );
  const suggestHandle = vi.fn(() => Promise.resolve({ handle: 'nick-2' }));
  const walletPass = vi.fn((_slug: string, member: string) => {
    const found = PAGES.find((each) => each.memberId === member);
    return Promise.resolve({ name: `${found?.handle ?? 'nobody'}.pkpass`, bytes: new Uint8Array([80, 75, 5, 6]) });
  });
  const data = {
    teamPages: {
      list,
      claim,
      addPerson,
      removePerson,
      invitePerson,
      cancelInvite,
      checkHandle,
      suggestHandle,
      walletPass,
      editedBy: () => Promise.resolve({}),
    },
    inbox: { unread: () => stillLoading },
  } as unknown as Partial<DataLayer>;
  return { data, claim, addPerson, removePerson, invitePerson, cancelInvite, checkHandle, walletPass };
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

describe('Apple Wallet passes from Team pages (13 Nov 2026)', () => {
  it('offers no pass where none can be made', async () => {
    await renderTeam(layerWith(ready).data);
    await expect.element(page.getByRole('button', { name: 'Download all QR codes' })).toBeEnabled();
    expect(document.body.textContent).not.toContain('Wallet');
    await userEvent.click(page.getByRole('button', { name: 'Actions for Bea Rao' }));
    await expect.element(page.getByRole('menuitem', { name: 'Download QR code (PNG)' })).toBeVisible();
    expect(page.getByRole('menuitem', { name: 'Download Wallet pass' }).query()).toBeNull();
  });

  it('downloads one Live page’s pass from its row, every Live page’s from the bar, and never a Private page’s', async () => {
    const { data, walletPass } = layerWith(() =>
      Promise.resolve({ pages: PAGES, month: '2026-11-01', hasWallet: true }),
    );
    await renderTeam(data);
    // A Private page has no pass: its row offers the codes and nothing of Wallet.
    await userEvent.click(page.getByRole('button', { name: 'Actions for Cy Okafor' }));
    await expect.element(page.getByRole('menuitem', { name: 'Download QR code (PNG)' })).toBeVisible();
    expect(page.getByRole('menuitem', { name: 'Download Wallet pass' }).query()).toBeNull();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(page.getByRole('button', { name: 'Actions for Bea Rao' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Download Wallet pass' }));
    await vi.waitFor(() => expect(walletPass).toHaveBeenCalledWith('acme', PAGES[1]?.memberId));

    // Everyone's: the two Live pages, one after another, then one zip and a line that counts them.
    walletPass.mockClear();
    await userEvent.click(page.getByRole('button', { name: 'Download all Wallet passes' }));
    await expect.element(page.getByText('2 Wallet passes downloaded.')).toBeVisible();
    expect(walletPass.mock.calls.map(([, member]) => member)).toEqual([PAGES[0]?.memberId, PAGES[1]?.memberId]);
    for (const theme of THEMES) {
      applyTheme(theme);
      expect(await axeViolations()).toEqual([]);
    }
  });
});

describe('a handle claimed for someone (AC-7002)', () => {
  it('opens the claim from a row with no page, checks the handle first, and shows the claimed row', async () => {
    const { data, claim } = layerWith(ready);
    await renderTeam(data);
    await userEvent.click(page.getByRole('button', { name: 'Actions for Dee Marsh' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Claim link' }));
    await expect.element(page.getByRole('dialog', { name: /Claim a link for Dee/ })).toBeVisible();
    // A link made from their name to start from.
    await expect.element(page.getByRole('textbox', { name: 'Link' })).toHaveValue('dee-marsh');
    // Emptied: refused before anything is sent.
    await userEvent.clear(page.getByRole('textbox', { name: 'Link' }));
    await userEvent.click(page.getByRole('button', { name: 'Claim', exact: true }));
    await expect.element(page.getByText('Add a link.')).toBeVisible();
    expect(claim).not.toHaveBeenCalled();
    await userEvent.fill(page.getByRole('textbox', { name: 'Link' }), 'dee');
    await userEvent.click(page.getByRole('button', { name: 'Claim', exact: true }));
    await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
    expect(claim).toHaveBeenCalledWith('acme', PAGES[3]?.memberId, 'dee');
    expect(document.body.textContent).toContain('/dee');
  });
});

describe('Add a page (9 Nov 2026)', () => {
  it('makes the link from the name, checks it as typed, and adds the Private row with its mark', async () => {
    const { data, addPerson, checkHandle } = layerWith(ready);
    await renderTeam(data);
    await userEvent.click(page.getByRole('button', { name: 'Add a page' }));
    await expect.element(page.getByRole('dialog', { name: 'Add a page' })).toBeVisible();
    // Nothing named: refused before anything is sent.
    await userEvent.click(page.getByRole('button', { name: 'Create page' }));
    await expect.element(page.getByText('Add their name.')).toBeVisible();
    expect(addPerson).not.toHaveBeenCalled();
    // The link follows the name; the name's own link is taken, so the free one takes its place, saying nothing.
    await userEvent.fill(page.getByRole('textbox', { name: 'Name' }), 'Nick');
    await expect.element(page.getByRole('textbox', { name: 'Link' }), { timeout: 4000 }).toHaveValue('nick-2');
    await expect.element(page.getByText('Available', { exact: true }), { timeout: 4000 }).toBeVisible();
    expect(document.body.textContent).not.toContain('Taken');
    expect(checkHandle).toHaveBeenCalledWith('acme', 'nick-2', expect.anything());
    // Typed by hand and taken: said on the field, with the free one to pick.
    await userEvent.fill(page.getByRole('textbox', { name: 'Link' }), 'nick');
    await expect.element(page.getByText('Taken. Pick another.')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'nick-2' }));
    await expect.element(page.getByRole('textbox', { name: 'Link' }), { timeout: 4000 }).toHaveValue('nick-2');
    await expect.element(page.getByText('Available', { exact: true }), { timeout: 4000 }).toBeVisible();
    await userEvent.fill(page.getByRole('textbox', { name: /Email/ }), 'not an email');
    await userEvent.click(page.getByRole('button', { name: 'Create page' }));
    await expect.element(page.getByText(/valid email address/)).toBeVisible();
    await userEvent.fill(page.getByRole('textbox', { name: /Email/ }), 'nick@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Create page' }));
    await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
    expect(addPerson).toHaveBeenCalledWith('acme', { name: 'Nick', email: 'nick@example.com', handle: 'nick-2' });
    await expect.element(page.getByRole('rowheader', { name: /Nick/ })).toBeVisible();
    expect(document.body.textContent).toContain('/nick-2');
    for (const theme of THEMES) {
      applyTheme(theme);
      expect(await axeViolations()).toEqual([]);
    }
  });

  it('offers Remove person only for a page only person, and asks first', async () => {
    const { data, removePerson } = layerWith(ready);
    await renderTeam(data);
    expect(document.body.textContent).toContain('Page only');
    await userEvent.click(page.getByRole('button', { name: 'Actions for Bea Rao' }));
    await expect.element(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
    expect(document.body.textContent).not.toContain('Remove person');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(page.getByRole('button', { name: 'Actions for Eve Page' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Remove person' }));
    await expect.element(page.getByRole('alertdialog', { name: 'Remove Eve Page?' })).toBeVisible();
    expect(removePerson).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole('button', { name: 'Remove person' }));
    await vi.waitFor(() => expect(removePerson).toHaveBeenCalledWith('acme', PAGES[4]?.memberId));
    await expect.element(page.getByRole('rowheader', { name: /Eve Page/ })).not.toBeInTheDocument();
  });
});

describe('Invite to manage their page (9 Nov 2026)', () => {
  it('is offered only with Members’ invite permission too', async () => {
    await renderTeam(layerWith(ready).data);
    await userEvent.click(page.getByRole('button', { name: 'Actions for Eve Page' }));
    await expect.element(page.getByRole('menuitem', { name: 'Remove person' })).toBeVisible();
    expect(document.body.textContent).not.toContain('Invite to manage their page');
  });

  it('starts from their address, marks the row Invited, and asks before revoking', async () => {
    const { data, invitePerson, cancelInvite } = layerWith(ready);
    await renderTeam(data, HAND_OVER);
    // Only a page only person's row offers it.
    await userEvent.click(page.getByRole('button', { name: 'Actions for Bea Rao' }));
    await expect.element(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
    expect(document.body.textContent).not.toContain('Invite to manage their page');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(page.getByRole('button', { name: 'Actions for Eve Page' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Invite to manage their page' }));
    await expect.element(page.getByRole('dialog', { name: 'Invite Eve to manage their page' })).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: /Email/ })).toHaveValue('eve@example.com');
    // Once the dialog has finished coming in (its entrance fades the text), axe judges what a person sees.
    await new Promise((settled) => setTimeout(settled, 400));
    for (const theme of THEMES) {
      applyTheme(theme);
      expect(await axeViolations()).toEqual([]);
    }
    // Emptied: refused before anything is sent.
    await userEvent.clear(page.getByRole('textbox', { name: /Email/ }));
    await userEvent.click(page.getByRole('button', { name: 'Send invitation' }));
    await expect.element(page.getByText('Add their email.')).toBeVisible();
    expect(invitePerson).not.toHaveBeenCalled();
    await userEvent.fill(page.getByRole('textbox', { name: /Email/ }), 'eve.page@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Send invitation' }));
    await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
    expect(invitePerson).toHaveBeenCalledWith('acme', PAGES[4]?.memberId, 'eve.page@example.com');
    await expect.element(page.getByRole('rowheader', { name: /Invited/ })).toBeVisible();
    // Sent once: the menu offers it again and a cancel, which asks first.
    await userEvent.click(page.getByRole('button', { name: 'Actions for Eve Page' }));
    await expect.element(page.getByRole('menuitem', { name: 'Resend invitation' })).toBeVisible();
    await userEvent.click(page.getByRole('menuitem', { name: 'Revoke invitation' }));
    await expect.element(page.getByRole('alertdialog', { name: 'Revoke the invitation to Eve Page?' })).toBeVisible();
    expect(document.body.textContent).toContain('eve.page@example.com stops working');
    expect(cancelInvite).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole('button', { name: 'Revoke invitation' }));
    await vi.waitFor(() => expect(cancelInvite).toHaveBeenCalledWith('acme', PAGES[4]?.memberId));
    await expect.element(page.getByRole('rowheader', { name: /Invited/ })).not.toBeInTheDocument();
  });

  it.runIf(import.meta.env.VITE_TEAM_SHOTS === '1')(
    'saves the hand over at 1280 and 390, light and dark',
    async () => {
      for (const [width, height] of [
        [1280, 860],
        [390, 844],
      ] as const) {
        await page.viewport(width, height);
        for (const theme of THEMES) {
          await renderTeam(layerWith(ready).data, HAND_OVER);
          applyTheme(theme);
          await userEvent.click(page.getByRole('button', { name: 'Actions for Eve Page' }));
          await expect.element(page.getByRole('menuitem', { name: 'Invite to manage their page' })).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/handover-menu-${String(width)}-${theme}.png` });
          await userEvent.click(page.getByRole('menuitem', { name: 'Invite to manage their page' }));
          await expect.element(page.getByRole('dialog')).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/handover-dialog-${String(width)}-${theme}.png` });
          await userEvent.click(page.getByRole('button', { name: 'Send invitation' }));
          await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
          await expect.element(page.getByRole('rowheader', { name: /Invited/ })).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/handover-invited-${String(width)}-${theme}.png` });
          await userEvent.click(page.getByRole('button', { name: 'Actions for Eve Page' }));
          await userEvent.click(page.getByRole('menuitem', { name: 'Revoke invitation' }));
          await expect.element(page.getByRole('alertdialog')).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/handover-cancel-${String(width)}-${theme}.png` });
          clear();
        }
      }
    },
    120_000,
  );
});

describe('Share (spec 0074, AC-7406)', () => {
  it('shares a page from its row in the one share sheet, keeping Copy link and the downloads', async () => {
    await renderTeam(layerWith(ready).data);
    await userEvent.click(page.getByRole('button', { name: 'Actions for Bea Rao' }));
    await expect.element(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
    await userEvent.click(page.getByRole('menuitem', { name: 'Share' }));
    const sheet = page.getByRole('dialog', { name: 'Share Bea Rao’s page' });
    await expect.element(sheet.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect.element(sheet.getByRole('link', { name: 'Open page' })).toBeVisible();
    await userEvent.click(sheet.getByRole('button', { name: 'Done' }));
    await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
  });

  it('says at the sheet’s foot that a Private page can’t be opened by visitors', async () => {
    await renderTeam(layerWith(ready).data);
    await userEvent.click(page.getByRole('button', { name: 'Actions for Cy Okafor' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Share' }));
    const sheet = page.getByRole('dialog', { name: 'Share Cy Okafor’s page' });
    await expect.element(sheet.getByText('Private. Visitors can’t open it until it’s live.')).toBeVisible();
    await userEvent.click(sheet.getByRole('button', { name: 'Done' }));
    await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
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
  it.runIf(import.meta.env.VITE_TEAM_SHOTS === '1')(
    'saves Team pages at 1280 and 390, light and dark',
    async () => {
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
          await userEvent.click(page.getByRole('menuitem', { name: 'Claim link' }));
          await expect.element(page.getByRole('dialog')).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/claim-${String(width)}-${theme}.png` });
          await userEvent.keyboard('{Escape}');
          await userEvent.click(page.getByRole('button', { name: 'Actions for Bea Rao' }));
          await expect.element(page.getByRole('menuitem', { name: 'Download QR code (PNG)' })).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/menu-${String(width)}-${theme}.png` });
          await userEvent.keyboard('{Escape}');
          // Add a page: empty, a taken link, filled, then the new row and a page only person's menu.
          await userEvent.click(page.getByRole('button', { name: 'Add a page' }));
          await expect.element(page.getByRole('dialog')).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/add-empty-${String(width)}-${theme}.png` });
          await userEvent.fill(page.getByRole('textbox', { name: 'Name' }), 'Nick');
          await expect.element(page.getByText('Available', { exact: true }), { timeout: 4000 }).toBeVisible();
          await userEvent.fill(page.getByRole('textbox', { name: 'Link' }), 'nick');
          await expect.element(page.getByText('Taken. Pick another.')).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/add-taken-${String(width)}-${theme}.png` });
          await userEvent.click(page.getByRole('button', { name: 'Cancel' }));
          await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
          await userEvent.click(page.getByRole('button', { name: 'Add a page' }));
          await userEvent.fill(page.getByRole('textbox', { name: 'Name' }), 'Kate Lim');
          await userEvent.fill(page.getByRole('textbox', { name: /Email/ }), 'kate@example.com');
          await expect.element(page.getByText('Available', { exact: true }), { timeout: 4000 }).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/add-filled-${String(width)}-${theme}.png` });
          await userEvent.click(page.getByRole('button', { name: 'Create page' }));
          await vi.waitFor(() => expect(openDialog('dialog')).toBeNull());
          await expect.element(page.getByRole('rowheader', { name: /Kate Lim/ })).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/added-${String(width)}-${theme}.png` });
          await userEvent.click(page.getByRole('button', { name: 'Actions for Eve Page' }));
          await expect.element(page.getByRole('menuitem', { name: 'Remove person' })).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/page-only-menu-${String(width)}-${theme}.png` });
          await userEvent.click(page.getByRole('menuitem', { name: 'Remove person' }));
          await expect.element(page.getByRole('alertdialog', { name: /Remove/ })).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/remove-${String(width)}-${theme}.png` });
          clear();
          await renderOverview();
          applyTheme(theme);
          await expect.element(page.getByText(/Edited by Ada Lovelace/)).toBeVisible();
          await page.screenshot({ path: `${SHOTS}/edited-by-${String(width)}-${theme}.png` });
          clear();
        }
      }
    },
    120_000,
  );
});
