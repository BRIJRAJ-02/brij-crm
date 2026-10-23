// Invitations (spec 0031, slice 2), end to end with three browsers: the owner invites two addresses from Settings ›
// Members, and each invitation's email reaches Mailpit with its link; the second person, signed in through the link
// as themself, opens the first person's link and is refused with the address masked, joining nothing; the first
// signs in through their link, accepts and lands in the workspace, and the owner's Members page shows them; the used
// link then reads as no longer valid, like any other bad link; Cancel invite asks first, Keep invitation keeps the
// invitation, and Cancel invitation ends it. Then the owner finds the newcomer by search, makes them an admin at once and removes them
// behind a confirm, after which they are in no workspace. axe in light and dark on the invitation page and the Members
// page (AC-803 to AC-806, AC-810, AC-811, AC-833).
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { codeFor, MAILPIT_URL } from './mailpit.ts';
import { checkScreen, newWorkspace } from './people.ts';

/**
 * `FLOW_NO_LIVE=1` runs the flow on an app whose origin Centrifugo doesn't admit (a second stack on another port):
 * the owner's page reloads where it would hear the newcomer live. CI runs it live.
 */
const isLive = process.env.FLOW_NO_LIVE !== '1';

interface MessageList {
  readonly messages: readonly { readonly ID: string; readonly To: readonly { readonly Address: string }[] | null }[];
}

/** The link in the newest invitation email to `email`, waiting up to 15 seconds for it to arrive. */
async function inviteLinkFor(request: APIRequestContext, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (await request.get(`${MAILPIT_URL}/api/v1/messages?limit=50`)).json()) as MessageList;
        for (const message of list.messages) {
          if (!(message.To ?? []).some((to) => to.Address.toLowerCase() === email.toLowerCase())) continue;
          const read = (await (await request.get(`${MAILPIT_URL}/api/v1/message/${message.ID}`)).json()) as {
            readonly Text: string;
          };
          const found = /\/invite\/([A-Za-z0-9_-]{43})/.exec(read.Text)?.[1];
          if (found !== undefined) {
            link = `/invite/${found}`;
            return link;
          }
        }
        return undefined;
      },
      { timeout: 15_000, message: `an invitation email for ${email} in Mailpit` },
    )
    .toBeDefined();
  if (link === undefined) throw new Error(`No invitation reached Mailpit for ${email}.`);
  return link;
}

/** Opens an invitation signed out, takes Sign in to accept, and signs `email` in; lands back on the invitation. */
async function signInThrough(page: Page, link: string, email: string): Promise<void> {
  await page.goto(link);
  await expect(page.getByRole('heading', { level: 1, name: /^Join / })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in to join' }).click();
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /^Continue( with email)?$/ }).click();
  await expect(page).toHaveURL(/\/verify/);
  await page.getByLabel('Code').fill(await codeFor(page.request, email));
  await expect(page).toHaveURL(new RegExp(`${link}$`));
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
}

/** The workspaces the page's signed in person is in, by address, through the API as their browser calls it. */
async function workspacesOf(page: Page): Promise<string[]> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post('/api/rpc/me/get', { data: { json: null }, headers: { origin } });
  expect(response.ok(), await response.text()).toBe(true);
  const me = ((await response.json()) as { json: { workspaces: { slug: string }[] } }).json;
  return me.workspaces.map((workspace) => workspace.slug);
}

test('invites two people: the wrong address is refused, the invited one joins, and Cancel invite asks first', async ({
  page,
  browser,
}, info) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1000, 'The members flow runs at desktop width.');
  test.setTimeout(240_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `members-${tag}`;
  const invitee = `grace-${tag}@example.com`;
  const other = `linus-${tag}@example.com`;
  await newWorkspace(page, `ada-${tag}@example.com`, slug);

  // The owner invites both from Settings › Members.
  await page.goto(`/w/${slug}/settings/members`);
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: /Ada Lovelace/ })).toBeVisible();
  // A lone owner sees the empty state under their row, with a secondary Invite people; the bar's is the primary.
  await expect(page.getByText('Just you so far')).toBeVisible();
  // Your own role reads as text: nobody changes their own role here.
  await expect(page.getByRole('button', { name: /Role for Ada Lovelace/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite people' }).first().click();
  const invite = page.getByRole('dialog', { name: 'Invite people' });
  // Nothing is prefilled, and an address that already belongs is refused in its row before anything is sent.
  await expect(invite.getByRole('textbox', { name: 'Email' })).toHaveValue('');
  await invite.getByRole('textbox', { name: 'Email' }).fill(`ada-${tag}@example.com`);
  await invite.getByRole('button', { name: /^Invite/ }).click();
  await expect(invite.getByText('Already a member.')).toBeVisible();
  // One row per person: Enter in the last row adds the next, which takes focus.
  await invite.getByRole('textbox', { name: 'Email' }).fill(invitee);
  await invite.getByRole('textbox', { name: 'Email' }).press('Enter');
  await expect(invite.getByRole('textbox', { name: 'Email 2' })).toBeFocused();
  await page.keyboard.type(other);
  await invite.getByRole('button', { name: 'Invite 2 people' }).click();
  await expect(invite.getByText(`Invited ${invitee}, ${other}.`, { exact: false })).toBeVisible();
  await invite.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('tab', { name: /Joining/ }).click();
  await expect(page.getByRole('rowheader', { name: invitee })).toBeVisible();
  // Joining holds the pending invitations, then the other ways in: the invite link, then the company email.
  await expect(page.getByRole('heading', { name: 'Pending invitations' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Other ways to join' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Invite link' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Company email' })).toBeVisible();
  await checkScreen(page, 'members-invitations');
  const link = await inviteLinkFor(page.request, invitee);

  // The other person signs in through the invited person's link, and is refused: the address masked, nothing joined.
  const otherContext = await browser.newContext();
  const stranger = await otherContext.newPage();
  await stranger.goto(link);
  await expect(stranger.getByText(/Sent to g\*\*\*@example\.com\./)).toBeVisible();
  await checkScreen(stranger, 'invite-signed-out');
  await signInThrough(stranger, link, other);
  await stranger.getByRole('button', { name: 'Join workspace' }).click();
  await expect(
    stranger.getByText('This invitation is for g***@example.com. Sign in with that address to accept.'),
  ).toBeVisible();
  await expect(stranger.getByRole('button', { name: 'Use another address' })).toBeVisible();
  expect(await workspacesOf(stranger)).toEqual([]);

  // The invited person signs in through their link, accepts, and lands in the workspace.
  const inviteeContext = await browser.newContext();
  const joiner = await inviteeContext.newPage();
  await signInThrough(joiner, link, invitee);
  await joiner.getByRole('button', { name: 'Join workspace' }).click();
  await expect(joiner).toHaveURL(new RegExp(`/w/${slug}/`), { timeout: 20_000 });
  expect(await workspacesOf(joiner)).toEqual([slug]);

  // The owner's Members page shows the newcomer, and their invitation is gone.
  if (!isLive) await page.reload();
  await page.getByRole('tab', { name: /Members/ }).click();
  await expect(page.getByRole('rowheader', { name: /grace/i })).toBeVisible({ timeout: 15_000 });
  await checkScreen(page, 'members-list');
  await page.getByRole('tab', { name: /Joining/ }).click();
  await expect(page.getByRole('rowheader', { name: invitee })).toHaveCount(0);

  // The used link now reads as no longer valid, like any other bad link.
  await stranger.goto(link);
  await expect(stranger.getByRole('heading', { level: 1, name: 'This invitation is no longer valid' })).toBeVisible();

  // Cancel invite asks first: Keep invitation keeps it; Cancel invitation ends it.
  const actions = page.getByRole('button', { name: `Actions for the invitation to ${other}` });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Cancel invite' }).click();
  const confirm = page.getByRole('alertdialog', { name: `Cancel the invitation to ${other}?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Keep invitation' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('rowheader', { name: other })).toBeVisible();
  await actions.click();
  await page.getByRole('menuitem', { name: 'Cancel invite' }).click();
  await confirm.getByRole('button', { name: 'Cancel invitation' }).click();
  await expect(page.getByText(`Invitation to ${other} cancelled.`)).toBeVisible();
  await expect(page.getByRole('rowheader', { name: other })).toHaveCount(0);

  // Slice 3: the owner finds the newcomer by search, makes them an admin at once, then removes them, which asks first.
  await page.getByRole('tab', { name: /Members/ }).click();
  await page.getByRole('textbox', { name: 'Search members' }).fill('grace');
  await expect(page).toHaveURL(/[?&]q=grace/i);
  await expect(page.getByRole('rowheader', { name: /Ada Lovelace/ })).toHaveCount(0);
  const grace = page.getByRole('rowheader', { name: /grace/i });
  await expect(grace).toBeVisible();
  await page.getByRole('button', { name: /Role for grace/i }).click();
  await page.getByRole('option', { name: 'Admin' }).click();
  await expect(page.getByText(/is now an Admin\./)).toBeVisible();
  await page.getByRole('button', { name: /^Actions for grace/i }).click();
  await page.getByRole('menuitem', { name: 'Remove from workspace' }).click();
  const remove = page.getByRole('alertdialog', { name: /^Remove grace.* from /i });
  await remove.getByRole('button', { name: 'Cancel' }).click();
  await expect(grace).toBeVisible();
  await page.getByRole('button', { name: /^Actions for grace/i }).click();
  await page.getByRole('menuitem', { name: 'Remove from workspace' }).click();
  // Slice 5: it reads what the removal does first; nothing names them, so there is nobody to hand work to.
  await expect(remove.getByRole('button', { name: 'Remove member' })).toBeEnabled();
  await expect(remove.getByRole('button', { name: /Hand their open tasks/ })).toHaveCount(0);
  await remove.getByRole('button', { name: 'Remove member' }).click();
  await expect(page.getByText(/was removed from the workspace\./)).toBeVisible();
  await expect(grace).toHaveCount(0);
  // Removed, they are in no workspace, and the workspace answers them as not found.
  expect(await workspacesOf(joiner)).toEqual([]);

  await otherContext.close();
  await inviteeContext.close();
});
