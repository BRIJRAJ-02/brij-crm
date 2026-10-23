// Settings › History (spec 0046, milestone 1), end to end with two browsers: the owner invites someone as an admin,
// they join, the owner lowers them to member, and History › Workspace changes reads both changes as sentences, newest
// first; then that member opens History and finds only their own sign ins, with no tab bar, and the changes address
// sends them on. axe in light and dark on both (AC-4600, AC-4601, AC-4603 to AC-4605, AC-4619).
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { codeFor, MAILPIT_URL } from './mailpit.ts';
import { checkScreen, newWorkspace } from './people.ts';

interface MessageList {
  readonly messages: readonly { readonly ID: string; readonly To: readonly { readonly Address: string }[] | null }[];
}

/** The link in the newest invitation email to `email`, waiting up to 15 seconds for it. */
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

/** Calls one procedure as the page's signed in person, as their browser would. */
async function rpc(page: Page, procedure: string, input: unknown): Promise<unknown> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`/api/rpc/${procedure}`, { data: { json: input }, headers: { origin } });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { json: unknown }).json;
}

test('History reads the workspace’s changes to its owner, and only their own sign ins to a member', async ({
  page,
  browser,
}, info) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1000, 'The history flow runs at desktop width.');
  test.setTimeout(240_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `history-${tag}`;
  const invitee = `grace-${tag}@example.com`;
  await newWorkspace(page, `ada-${tag}@example.com`, slug);

  // The owner invites Grace as an admin (through the app's own call; Members has its own flow).
  await rpc(page, 'invitations/create', {
    workspace: slug,
    emails: [invitee],
    role: 'admin',
    mutationId: randomUUID(),
  });
  const link = await inviteLinkFor(page.request, invitee);

  // Grace signs in through her link and joins.
  const graceContext = await browser.newContext();
  const grace = await graceContext.newPage();
  await grace.goto(link);
  await grace.getByRole('link', { name: 'Sign in to join' }).click();
  await grace.getByLabel('Email').fill(invitee);
  await grace.getByRole('button', { name: /^Continue( with email)?$/ }).click();
  await expect(grace).toHaveURL(/\/verify/);
  await grace.getByLabel('Code').fill(await codeFor(grace.request, invitee));
  await expect(grace.getByText(`Signed in as ${invitee}`)).toBeVisible();
  await grace.getByRole('button', { name: 'Join workspace' }).click();
  await expect(grace).toHaveURL(new RegExp(`/w/${slug}/`), { timeout: 20_000 });

  // The owner lowers her to member.
  const { memberId } = (await rpc(grace, 'access/mine', { workspace: slug })) as { memberId: string };
  await rpc(page, 'members/setRole', { workspace: slug, memberId, role: 'member', mutationId: randomUUID() });

  // History, from the settings navigation, opens on Workspace changes for the owner.
  await page.goto(`/w/${slug}/settings/general`);
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/settings/history/changes$`));
  await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveText(['Workspace changes', 'Your sign ins']);
  const table = page.getByRole('grid', { name: 'Workspace changes' });
  const role = table.getByRole('rowheader', { name: /^Ada Lovelace changed grace.*’s role from Admin to Member$/ });
  const invited = table.getByRole('rowheader', { name: `Ada Lovelace invited ${invitee} as Admin` });
  await expect(role).toBeVisible();
  await expect(invited).toBeVisible();
  await expect(
    table.getByRole('rowheader', { name: /^grace.* accepted the invitation and joined as Admin$/ }),
  ).toBeVisible();
  // Newest first: the role change sits above the invitation.
  const rows = await table.getByRole('rowheader').allTextContents();
  const at = (pattern: RegExp) => rows.findIndex((text) => pattern.test(text));
  expect(at(/role from Admin to Member/)).toBeLessThan(at(new RegExp(`invited ${invitee}`)));
  await checkScreen(page, 'history-changes');

  // Your sign ins, its own address.
  await page.getByRole('tab', { name: 'Your sign ins' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/settings/history/sign-ins$`));
  await expect(page.getByText('Signed in').first()).toBeVisible();

  // Grace, a member now, finds her own sign ins with no tab bar, and the changes address sends her on.
  await grace.goto(`/w/${slug}/settings/history`);
  await expect(grace).toHaveURL(new RegExp(`/w/${slug}/settings/history/sign-ins$`));
  await expect(grace.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
  await expect(grace.getByText('Signed in').first()).toBeVisible();
  await expect(grace.getByRole('tablist')).toHaveCount(0);
  await expect(grace.getByRole('grid', { name: 'Workspace changes' })).toHaveCount(0);
  await checkScreen(grace, 'history-sign-ins');
  await grace.goto(`/w/${slug}/settings/history/changes`);
  await expect(grace).toHaveURL(new RegExp(`/w/${slug}/settings/history/sign-ins$`));
  await expect(grace.getByRole('tablist')).toHaveCount(0);

  await graceContext.close();
});
