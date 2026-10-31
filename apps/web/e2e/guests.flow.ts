// Guests (spec 0031, slice 9; spec 0037, AC-1432), end to end with two browsers: the owner invites someone as a
// Guest from Settings › Members; they join and see "Nothing has been shared with you yet", a sidebar with no
// Scheduling, Settings with no Scheduling access, and Members with no one's email. The owner shares Companies with
// Guests on its Access tab (view only: Can edit stays off for them), and the guest then opens on Companies. The owner
// makes the guest a Member at once, then a Guest again behind a confirm that counts the booking page that pauses and
// the link page that hides, which a visitor then can't open.
// axe in light and dark on each screen, with pictures when FLOW_SCREENSHOTS names a folder.
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { codeFor, MAILPIT_URL } from './mailpit.ts';
import { checkScreen, newWorkspace } from './people.ts';

/** A UUID v7, as the app mints them. */
function uuidv7(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(random.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

/** Calls one oRPC procedure as the page's signed in person, from the app's own origin. */
async function rpc(page: Page, procedure: string, input: unknown): Promise<unknown> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`/api/rpc/${procedure}`, { data: { json: input }, headers: { origin } });
  expect(response.ok(), `${procedure}: ${await response.text()}`).toBe(true);
  return ((await response.json()) as { json: unknown }).json;
}

const SHOTS = process.env.FLOW_SCREENSHOTS;

/** axe in light and dark (`checkScreen`), and with FLOW_SCREENSHOTS, pictures at 1440, 2000 and a phone's width. */
async function check(page: Page, name: string): Promise<void> {
  await checkScreen(page, name);
  if (SHOTS === undefined) return;
  const was = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const width of [1440, 2000, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // The theme's colour transitions settle first, so a picture never catches a control mid change.
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `${String(width)}-${name}-${scheme}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize(was);
}

interface MessageList {
  readonly messages: readonly { readonly ID: string; readonly To: readonly { readonly Address: string }[] | null }[];
}

/** The link in the newest invitation email to `email`. */
async function inviteLinkFor(page: Page, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (await page.request.get(`${MAILPIT_URL}/api/v1/messages?limit=50`)).json()) as MessageList;
        for (const message of list.messages) {
          if (!(message.To ?? []).some((to) => to.Address.toLowerCase() === email.toLowerCase())) continue;
          const read = (await (await page.request.get(`${MAILPIT_URL}/api/v1/message/${message.ID}`)).json()) as {
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
      { timeout: 15_000, message: `an invitation email for ${email}` },
    )
    .toBeDefined();
  if (link === undefined) throw new Error(`No invitation for ${email}.`);
  return link;
}

test('a guest sees only what is shared with them, and becoming one asks first', async ({ page, browser }, info) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1000, 'The guests flow runs at desktop width.');
  test.setTimeout(240_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `guests-${tag}`;
  const email = `gus-${tag}@example.com`;
  await newWorkspace(page, `ada-${tag}@example.com`, slug);

  // The owner invites Gus as a Guest.
  await page.goto(`/w/${slug}/settings/members`);
  await page.getByRole('button', { name: 'Invite people' }).first().click();
  const invite = page.getByRole('dialog', { name: 'Invite people' });
  await invite.getByRole('textbox', { name: 'Email' }).fill(email);
  await invite.getByRole('button', { name: /Role for/ }).click();
  await page.getByRole('option', { name: 'Guest' }).click();
  await check(page, 'guests-invite');
  await invite.getByRole('button', { name: /^Invite/ }).click();
  await expect(invite).toHaveCount(0);
  const link = await inviteLinkFor(page, email);

  // Gus joins through his link, and finds nothing shared yet.
  const gusContext = await browser.newContext();
  const gus = await gusContext.newPage();
  await gus.goto(link);
  await gus.getByRole('link', { name: 'Sign in to join' }).click();
  await gus.getByLabel('Email').fill(email);
  await gus.getByRole('button', { name: /^Continue( with email)?$/ }).click();
  await expect(gus).toHaveURL(/\/verify/);
  await gus.getByLabel('Code').fill(await codeFor(gus.request, email));
  await gus.getByRole('button', { name: 'Join workspace' }).click();
  await expect(gus).toHaveURL(new RegExp(`/w/${slug}(/|$)`), { timeout: 20_000 });
  await gus.goto(`/w/${slug}`);
  await expect(gus.getByText('Nothing has been shared with you yet')).toBeVisible();
  await expect(gus.getByText('Ask an admin.')).toBeVisible();
  const sidebar = gus.getByRole('navigation', { name: 'Main navigation' });
  await expect(sidebar.getByRole('link', { name: 'Bookings' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Companies', exact: true })).toHaveCount(0);
  await check(gus, 'guests-nothing-shared');

  // Settings: no Scheduling access, and Members without anyone's email.
  await gus.goto(`/w/${slug}/settings/members`);
  await expect(gus.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  await expect(gus.getByRole('link', { name: 'Scheduling access' })).toHaveCount(0);
  await expect(gus.getByRole('link', { name: 'Teams' })).toHaveCount(0);
  await expect(gus.getByRole('columnheader', { name: 'Email' })).toHaveCount(0);
  await expect(gus.getByText(`ada-${tag}@example.com`)).toHaveCount(0);
  await check(gus, 'guests-members');

  // The owner shares Companies with Guests, to view: Can edit stays off for them.
  await page.goto(`/w/${slug}/settings/objects/companies/access`);
  const grid = page.getByRole('grid', { name: 'Who can do what' });
  await expect(grid.getByRole('checkbox', { name: 'Can edit, Guests' })).toBeDisabled();
  await grid.getByRole('checkbox', { name: 'Can see, Guests' }).check({ force: true });
  await expect(page.getByText('Members can edit Companies. Guests can view Companies.')).toBeVisible();
  await check(page, 'guests-access-tab');

  // Gus now opens on Companies.
  await gus.goto(`/w/${slug}`);
  await expect(gus).toHaveURL(new RegExp(`/w/${slug}/objects/companies`), { timeout: 15_000 });
  await expect(sidebar.getByRole('link', { name: 'Companies', exact: true })).toBeVisible();
  // Viewing only: no Import / Export, no row ticks and no select all.
  await expect(gus.getByRole('button', { name: 'Import / Export' })).toHaveCount(0);
  await expect(gus.getByRole('grid').getByRole('checkbox')).toHaveCount(0);
  await check(gus, 'guests-companies');

  // The owner makes Gus a Member at once; he makes a booking page; back to Guest asks first and counts the page.
  await page.goto(`/w/${slug}/settings/members`);
  await page.getByRole('button', { name: /Role for gus/i }).click();
  await page.getByRole('option', { name: 'Member' }).click();
  await expect(page.getByText(/is now a Member\./)).toBeVisible();
  await rpc(gus, 'bookingPages/create', {
    workspace: slug,
    id: uuidv7(),
    title: 'Intro call',
    timeZone: 'UTC',
    mutationId: uuidv7(),
  });
  // A member has a link page; once shared it is live at his handle.
  await rpc(gus, 'profile/show', { workspace: slug, mutationId: uuidv7() });
  const { handle } = (await rpc(gus, 'profile/get', { workspace: slug })) as { handle: string };
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(`/${handle}`);
  await expect(visitor.getByRole('heading', { level: 1 })).toContainText(/gus/i);
  await page.getByRole('button', { name: /Role for gus/i }).click();
  await expect(page.getByRole('option', { name: 'Guest' })).toBeVisible();
  await check(page, 'guests-role-menu');
  await page.getByRole('option', { name: 'Guest' }).click();
  const confirm = page.getByRole('alertdialog', { name: /^Make gus.* a Guest\?$/i });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText('1 page paused')).toBeVisible();
  await expect(confirm.getByText('Link page hidden')).toBeVisible();
  await check(page, 'guests-confirm');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('button', { name: /Role for gus/i })).toHaveText(/Member/);
  await page.getByRole('button', { name: /Role for gus/i }).click();
  await page.getByRole('option', { name: 'Guest' }).click();
  await confirm.getByRole('button', { name: 'Make Guest' }).click();
  await expect(page.getByText(/is now a Guest\./)).toBeVisible();
  await expect(page.getByRole('button', { name: /Role for gus/i })).toHaveText(/Guest/);
  // His link page is hidden at its address, its contents kept for a later return.
  await visitor.reload();
  await expect(visitor.getByRole('heading', { level: 1 })).not.toContainText(/gus/i);
  await check(visitor, 'guests-link-page-hidden');

  await visitorContext.close();
  await gusContext.close();
});
