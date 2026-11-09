// A team link end to end, as an owner and a guest live it (6 November 2026, the owner's "this has some issues, also the
// flow"): a first round robin page made from nothing, with its people picked in the one dialog; the draft's phone shows
// the page rather than Page not found; Hosts says who can be booked; a guest reads the page's own title, books, moves
// and cancels; a group a page books from says so before Delete; Resume with nobody on it is refused and says why; delete
// asks first. A live page that has lost its hosts (they left) can't be reached from here: `team-readiness.test.ts`, and
// the public page's browser test, hold that.
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { codeFor, MAILPIT_URL } from './mailpit.ts';
import { checkScreen, firstRun } from './people.ts';

/** The booking page's bot check wants a human's pace before Confirm. */
const HUMAN_PACE_MS = 3_500;

/** The link in the newest invitation email to `email`. */
async function inviteLinkFor(request: APIRequestContext, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (await request.get(`${MAILPIT_URL}/api/v1/messages?limit=50`)).json()) as {
          readonly messages: readonly {
            readonly ID: string;
            readonly To: readonly { readonly Address: string }[] | null;
          }[];
        };
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
      { timeout: 15_000, message: `an invitation email for ${email}` },
    )
    .toBeDefined();
  if (link === undefined) throw new Error(`No invitation reached Mailpit for ${email}.`);
  return link;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /^Continue( with email)?$/ }).click();
  await expect(page).toHaveURL(/\/verify/);
  await page.getByLabel('Code').fill(await codeFor(page.request, email));
}

test.describe('a team link', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough for the journey.');

  test('made from nothing, booked by a guest, and honest when nobody can be booked', async ({ page, browser }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(20_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `teamlink-${tag}`;
    const grace = `grace-${tag}@example.com`;
    const linus = `linus-${tag}@example.com`;
    await signIn(page, `brij-${tag}@example.com`);
    await firstRun(page, slug, 'Brij Raj');

    // One colleague joins; one is only invited.
    await page.goto(`/w/${slug}/settings/members`);
    await page.getByRole('button', { name: 'Invite people' }).first().click();
    const invite = page.getByRole('dialog', { name: 'Invite people' });
    await invite.getByRole('textbox', { name: 'Email' }).fill(grace);
    await invite.getByRole('textbox', { name: 'Email' }).press('Enter');
    await page.keyboard.type(linus);
    await invite.getByRole('button', { name: 'Invite 2 people' }).click();
    await expect(page.getByText('Invited 2 people')).toBeVisible();
    const link = await inviteLinkFor(page.request, grace);
    const graceContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const gracePage = await graceContext.newPage();
    await signIn(gracePage, grace);
    await gracePage.waitForURL(/\/welcome|\/w\//);
    await gracePage.goto(link);
    await gracePage.getByRole('button', { name: 'Join workspace' }).click();
    await gracePage.waitForURL(/\/w\//);
    await graceContext.close();

    // A first team page: the people are picked here, and the group comes with the page.
    await page.goto(`/w/${slug}/captures/links`);
    await page.getByRole('button', { name: /^New booking page/ }).click();
    const dialog = page.getByRole('dialog', { name: 'New booking page' });
    await dialog.getByLabel('Title').fill('Team Link');
    await dialog.getByRole('radio', { name: /Round robin/ }).check({ force: true });
    await expect(dialog.getByText('Manage round robin')).toHaveCount(0);
    // Too few people is said on the picker, and nothing is made.
    await dialog.getByRole('button', { name: 'Create page' }).click();
    await expect(dialog.getByText('Add at least 2 members.')).toBeVisible();
    await dialog.getByRole('button', { name: /People/ }).click();
    const options = page.getByRole('option');
    await expect(options.filter({ hasText: 'Brij Raj' })).toBeVisible();
    await expect(options.filter({ hasText: 'Grace' })).toBeVisible();
    // Someone only invited isn't offered yet, and the hint says why.
    await expect(options.filter({ hasText: linus })).toHaveCount(0);
    await options.filter({ hasText: 'Brij Raj' }).click();
    await options.filter({ hasText: 'Grace' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog.getByText('Someone invited shows here once they join.')).toBeVisible();
    await checkScreen(page, 'team-link-new');
    await dialog.getByRole('button', { name: 'Create page' }).click();
    await expect(page).toHaveURL(/\/captures\/links\/[0-9a-f-]{36}/, { timeout: 30_000 });

    // The draft's phone shows the page, under its own title: never Page not found, never the workspace as a host.
    const phone = page.frameLocator('iframe[title]');
    await expect(phone.getByRole('heading', { level: 1, name: 'Team Link', exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(phone.getByText('Page not found')).toHaveCount(0);
    await expect(
      phone
        .getByRole('list', { name: /^Times on / })
        .getByRole('button')
        .first(),
    ).toBeVisible();
    await checkScreen(page, 'team-link-editor-draft');

    // Hosts comes straight after Page, and says who can be booked, whose calendar is missing, and nothing to add.
    const tabs = page.getByRole('tablist').getByRole('tab');
    await expect(tabs.nth(1)).toHaveText('Hosts');
    await page.getByRole('tab', { name: 'Hosts', exact: true }).click();
    const who = page.getByRole('grid', { name: 'Who can be booked' });
    await expect(who.getByRole('row', { name: /Brij Raj/ })).toContainText('No calendar');
    await expect(who.getByRole('row', { name: /Grace/ })).toContainText('On');
    await expect(page.getByText('Goes live when saved.')).toHaveCount(0);
    await expect(page.getByLabel('Add a group')).toHaveCount(0);
    await checkScreen(page, 'team-link-hosts');

    // The rest of a team page says what is true of it.
    await page.getByRole('tab', { name: 'Availability', exact: true }).click();
    await expect(page.getByRole('link', { name: 'See everyone’s hours' })).toBeVisible();
    await page.getByRole('tab', { name: 'Meeting', exact: true }).click();
    await expect(page.getByText('Add bookings to')).toHaveCount(0);

    // Publish, then the link.
    await page.getByRole('tab', { name: 'Page', exact: true }).click();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const live = page.getByRole('dialog', { name: /is live$/ });
    await expect(live).toBeVisible({ timeout: 15_000 });
    await live.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Live', { exact: true }).first()).toBeVisible();
    const address = await page.getByRole('textbox', { name: 'Web address' }).inputValue();

    // The guest: the page's own title in the rail and the tab.
    const guestContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const guest = await guestContext.newPage();
    await guest.goto(address);
    await expect(guest.getByRole('heading', { level: 1, name: 'Team Link', exact: true })).toBeVisible();
    await expect(guest).toHaveTitle('Team Link');
    await expect(guest.getByText(/with Brij/)).toHaveCount(0);
    await checkScreen(guest, 'team-link-guest');

    // Books, and the confirmation names who got it; then moves it and cancels it.
    await guest
      .getByRole('list', { name: /^Times on / })
      .getByRole('button')
      .first()
      .click();
    await guest.getByRole('button', { name: /^Book / }).click();
    await guest.getByLabel('Your name').fill('Vera Visitor');
    await guest.getByLabel('Email').fill(`vera-${tag}@example.com`);
    await guest.waitForTimeout(HUMAN_PACE_MS);
    await guest.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(guest).toHaveURL(/\/manage\?/, { timeout: 30_000 });
    await expect(guest.getByText('You’re booked')).toBeVisible();
    await expect(guest.getByText(/with (Brij Raj|Grace)/).first()).toBeVisible();
    await guest.getByRole('button', { name: 'Move to another time' }).click();
    await guest
      .getByRole('list', { name: /^Times on / })
      .getByRole('button')
      .last()
      .click();
    await guest.getByRole('button', { name: /^Move to \d/ }).click();
    await expect(guest.getByText('Moved.')).toBeVisible({ timeout: 15_000 });

    // The page's own Bookings has it.
    await page.getByRole('tab', { name: 'Bookings', exact: true }).click();
    await expect(page.getByText('Vera Visitor').first()).toBeVisible({ timeout: 15_000 });

    await guest.getByRole('button', { name: 'Cancel booking' }).click();
    await guest.getByRole('button', { name: 'Cancel booking' }).last().click();
    await expect(guest.getByRole('button', { name: 'Move to another time' })).toBeHidden({ timeout: 15_000 });

    // Paused, the guest reads that it isn't taking bookings. A group can only be emptied while its page is paused.
    const editor = page.url().split('?')[0] ?? '';
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Pause' }).click();
    await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
    await guest.goto(address);
    await expect(guest.getByText(/isn’t taking bookings|Nothing is bookable/).first()).toBeVisible();

    // Everyone switched off, from the group's More options.
    await page.goto(`/w/${slug}/bookings/settings/teams`);
    await page.getByRole('button', { name: 'More for Team Link' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    // A group a page books from says so before anything is pressed.
    await expect(page.getByText('Team Link is still in use')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete group' })).toHaveCount(0);
    await checkScreen(page, 'team-link-group-in-use');
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.getByRole('button', { name: 'More for Team Link' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const group = page.getByRole('dialog').first();
    await group.getByRole('button', { name: 'More options' }).click();
    for (const name of [/^Brij Raj takes meetings/, /^Grace.* takes meetings/]) {
      await group.getByRole('switch', { name }).focus();
      await page.keyboard.press('Space');
    }
    await group.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved Team Link.')).toBeVisible();

    // Taking bookings again with nobody to book is refused, and says why.
    await page.goto(editor);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Resume' }).click();
    await expect(page.getByText('Nobody is switched on in Team Link').first()).toBeVisible();
    await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
    await checkScreen(page, 'team-link-resume-refused');
    await guestContext.close();

    // Delete asks first.
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete booking page' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Delete “Team Link”?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
  });
});
