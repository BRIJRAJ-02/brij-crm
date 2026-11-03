// Round robin end to end (spec 0029), as a team that has just started lives it (QA, 4 November 2026): the owner
// invites two people, who join and set nothing; the owner makes a group of all three straight away (nobody is
// refused for hours they never saved), then a round robin page from Captures without picking the only group; three
// visitors book and the meetings go one to each host, each named on the visitor's page; the admin's Team calendar
// shows each host's meeting inside their hours, in the workspace's own time zone.
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { codeFor, MAILPIT_URL } from './mailpit.ts';
import { newWorkspace } from './people.ts';

/** The booking page's bot check wants a human's pace before Confirm. */
const HUMAN_PACE_MS = 3_500;

/** The link in the newest invitation email to `email`. */
async function inviteLinkFor(request: APIRequestContext, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (await request.get(`${MAILPIT_URL}/api/v1/messages?limit=50`)).json()) as {
          readonly messages: readonly { readonly ID: string; readonly To: readonly { Address: string }[] | null }[];
        };
        for (const message of list.messages) {
          if (!(message.To ?? []).some((to) => to.Address.toLowerCase() === email)) continue;
          const read = (await (await request.get(`${MAILPIT_URL}/api/v1/message/${message.ID}`)).json()) as {
            readonly Text: string;
          };
          link = /\/invite\/[A-Za-z0-9_-]{43}/.exec(read.Text)?.[0];
          if (link !== undefined) return link;
        }
        return undefined;
      },
      { timeout: 15_000, message: `an invitation email for ${email}` },
    )
    .toBeDefined();
  return link ?? '';
}

/** Joins through the invitation in a browser of its own, setting nothing else. */
async function join(page: Page, link: string, email: string, slug: string): Promise<void> {
  await page.goto(link);
  await page.getByRole('link', { name: 'Sign in to join' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /^Continue( with email)?$/ }).click();
  await page.getByLabel('Code').fill(await codeFor(page.request, email));
  await page.getByRole('button', { name: 'Join workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/`), { timeout: 30_000 });
}

test.describe('round robin', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough for the journey.');

  test('a team that just joined makes a group and a page, and three bookings go one to each host', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `roundrobin-${tag}`;
    await newWorkspace(page, `rr-${tag}@example.com`, slug);

    // Two people join, and set no hours of their own.
    await page.goto(`/w/${slug}/settings/members`);
    await page.getByRole('button', { name: 'Invite people' }).first().click();
    const invite = page.getByRole('dialog', { name: 'Invite people' });
    const people = [`sam-${tag}@example.com`, `rita-${tag}@example.com`];
    await invite.getByRole('textbox', { name: 'Email' }).fill(people[0] ?? '');
    await invite.getByRole('textbox', { name: 'Email' }).press('Enter');
    await page.keyboard.type(people[1] ?? '');
    await invite.getByRole('button', { name: 'Invite 2 people' }).click();
    await expect(page.getByText('Invited 2 people')).toBeVisible();
    for (const email of people) {
      const context = await browser.newContext();
      await join(await context.newPage(), await inviteLinkFor(page.request, email), email, slug);
      await context.close();
    }

    // The group, all three at once: nobody is refused for missing hours.
    await page.goto(`/w/${slug}/bookings/round-robin`);
    await page.getByRole('button', { name: 'New group' }).first().click();
    const group = page.getByRole('dialog', { name: 'New group' });
    await group.getByLabel('Name').fill('Sales team');
    for (let added = 0; added < 3; added += 1) {
      await group.getByRole('button', { name: /Add a member/ }).click();
      await page.getByRole('option').first().click();
    }
    await group.getByRole('button', { name: 'Create group' }).click();
    await expect(page.getByText('Made Sales team.')).toBeVisible();
    await expect(group).toHaveCount(0);

    // The page, on the only group without picking it.
    await page.goto(`/w/${slug}/captures/links`);
    await page.getByRole('button', { name: /^New booking page/ }).click();
    const create = page.getByRole('dialog', { name: 'Add a booking page' });
    await create.getByLabel('Title').fill('Sales intro');
    await create.getByText('Round robin group', { exact: true }).click();
    await create.getByRole('button', { name: 'Create page' }).click();
    await page.getByRole('button', { name: 'Edit page' }).click();
    await expect(page).toHaveURL(/\/captures\/links\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const address = await page.getByRole('link', { name: 'View page' }).getAttribute('href');
    expect(address).not.toBeNull();

    // Three visitors, three hosts: the fewest meetings goes first, so nobody gets two.
    const hosts: string[] = [];
    for (let visit = 0; visit < 3; visit += 1) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const visitor = await context.newPage();
      await visitor.goto(address ?? '');
      await expect(visitor.getByRole('group', { name: 'Team of 3' })).toBeVisible();
      await visitor
        .getByRole('list', { name: /^Times on / })
        .getByRole('button')
        .nth(visit)
        .click();
      await visitor.getByRole('button', { name: /^Book / }).click();
      await visitor.getByLabel('Your name').fill(`Visitor ${String(visit)}`);
      await visitor.getByLabel('Email').fill(`visitor-${String(visit)}-${tag}@example.com`);
      await visitor.waitForTimeout(HUMAN_PACE_MS);
      await visitor.getByRole('button', { name: 'Confirm booking' }).click();
      await expect(visitor).toHaveURL(/\/manage\?/, { timeout: 30_000 });
      const line = (await visitor.getByText(/ will see you then\.$/).textContent()) ?? '';
      hosts.push(line.replace(' will see you then.', ''));
      await context.close();
    }
    expect(new Set(hosts).size).toBe(3);

    // The Team calendar holds each host's meeting inside their hours: no "Outside hours" on a team in its own zone.
    await page.goto(`/w/${slug}/bookings/calendar`);
    await page.getByRole('radio', { name: 'Team' }).click({ force: true });
    const team = page.getByRole('region', { name: /^Team, / });
    await expect(team.getByRole('button', { name: /^Sales intro, / })).toHaveCount(3);
    await expect(team.getByRole('button', { name: /Outside hours/ })).toHaveCount(0);
  });
});
