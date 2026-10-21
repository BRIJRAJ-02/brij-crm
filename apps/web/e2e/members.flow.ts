// Invitations (spec 0031, slice 2), end to end with three browsers: the owner invites two addresses from Settings ›
// Members, and each invitation's email reaches Mailpit with its link; the second person, signed in through the link
// as themself, opens the first person's link and is refused with the address masked, joining nothing; the first
// signs in through their link, accepts and lands in the workspace, and the owner's Members page shows them; the used
// link then reads as no longer valid, like any other bad link; Revoke asks first, Cancel keeps the invitation, and
// Revoke invitation ends it. axe in light and dark on the invitation page and the Members page (AC-803 to AC-806,
// AC-810, AC-833).
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
  await expect(page.getByRole('heading', { level: 1, name: 'Join a workspace' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in to accept' }).click();
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /^Continue( with email)?$/ }).click();
  await expect(page).toHaveURL(/\/verify/);
  await page.getByLabel('Code').fill(await codeFor(page.request, email));
  await expect(page).toHaveURL(new RegExp(`${link}$`));
  await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible();
}

/** The workspaces the page's signed in person is in, by address, through the API as their browser calls it. */
async function workspacesOf(page: Page): Promise<string[]> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post('/api/rpc/me/get', { data: { json: null }, headers: { origin } });
  expect(response.ok(), await response.text()).toBe(true);
  const me = ((await response.json()) as { json: { workspaces: { slug: string }[] } }).json;
  return me.workspaces.map((workspace) => workspace.slug);
}

test('invites two people: the wrong address is refused, the invited one joins, and Revoke asks first', async ({
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
  await page.getByRole('button', { name: 'Invite people' }).click();
  const invite = page.getByRole('dialog', { name: 'Invite people' });
  await invite.getByLabel('Email addresses').fill(`${invitee}, ${other}`);
  await invite.getByRole('button', { name: 'Send invitations' }).click();
  await expect(page.getByText('2 invitations sent.')).toBeVisible();
  await page.getByRole('tab', { name: /Invitations/ }).click();
  await expect(page.getByRole('rowheader', { name: invitee })).toBeVisible();
  await checkScreen(page, 'members-invitations');
  const link = await inviteLinkFor(page.request, invitee);

  // The other person signs in through the invited person's link, and is refused: the address masked, nothing joined.
  const otherContext = await browser.newContext();
  const stranger = await otherContext.newPage();
  await stranger.goto(link);
  await expect(stranger.getByText(/This invitation is for g\*\*\*@example\.com\./)).toBeVisible();
  await checkScreen(stranger, 'invite-signed-out');
  await signInThrough(stranger, link, other);
  await stranger.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(
    stranger.getByText('This invitation is for g***@example.com. Sign in with that address to accept.'),
  ).toBeVisible();
  await expect(stranger.getByRole('button', { name: 'Sign in with another address' })).toBeVisible();
  expect(await workspacesOf(stranger)).toEqual([]);

  // The invited person signs in through their link, accepts, and lands in the workspace.
  const inviteeContext = await browser.newContext();
  const joiner = await inviteeContext.newPage();
  await signInThrough(joiner, link, invitee);
  await joiner.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(joiner).toHaveURL(new RegExp(`/w/${slug}/`), { timeout: 20_000 });
  expect(await workspacesOf(joiner)).toEqual([slug]);

  // The owner's Members page shows the newcomer, and their invitation is gone.
  if (!isLive) await page.reload();
  await page.getByRole('tab', { name: /Members/ }).click();
  await expect(page.getByRole('rowheader', { name: /grace/ })).toBeVisible({ timeout: 15_000 });
  await checkScreen(page, 'members-list');
  await page.getByRole('tab', { name: /Invitations/ }).click();
  await expect(page.getByRole('rowheader', { name: invitee })).toHaveCount(0);

  // The used link now reads as no longer valid, like any other bad link.
  await stranger.goto(link);
  await expect(stranger.getByRole('heading', { level: 1, name: 'This invitation is no longer valid' })).toBeVisible();

  // Revoke asks first: Cancel keeps the invitation; Revoke invitation ends it.
  const actions = page.getByRole('button', { name: `Actions for the invitation to ${other}` });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Revoke' }).click();
  const confirm = page.getByRole('alertdialog', { name: `Revoke the invitation to ${other}?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('rowheader', { name: other })).toBeVisible();
  await actions.click();
  await page.getByRole('menuitem', { name: 'Revoke' }).click();
  await confirm.getByRole('button', { name: 'Revoke invitation' }).click();
  await expect(page.getByText(`Invitation to ${other} revoked.`)).toBeVisible();
  await expect(page.getByRole('rowheader', { name: other })).toHaveCount(0);

  await otherContext.close();
  await inviteeContext.close();
});
