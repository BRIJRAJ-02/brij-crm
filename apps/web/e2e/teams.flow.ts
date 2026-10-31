// Teams and access by team (specs 0031 slice 8 and 0032), end to end. The owner makes a team from Settings › Teams,
// renames it, fills it, deletes it and takes the delete back with Undo; then, on Deals' Access tab, takes Members'
// access away and gives it to the Sales team, with one plain line saying the result. A member in no team no longer
// finds Deals; put in Sales, they do. A member opening the Access tab's address is told it is for owners and admins,
// and reads Teams without a way to change it (AC-824 to AC-827, AC-843, AC-844, AC-854, AC-856). A third test hides
// Deals' Value from Members under Fields: the member's open table loses the column without a reload, the owner sees how
// many people lost it with Undo, Preview as shows the member's view with an Exit, and Undo brings the column back
// (AC-846, AC-850, AC-852, AC-858).
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { codeFor, MAILPIT_URL } from './mailpit.ts';
import { checkScreen, newWorkspace } from './people.ts';

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

/** Opens an invitation signed out, signs `email` in through Mailpit, and accepts; lands in the workspace. */
async function joinThrough(page: Page, link: string, email: string, slug: string): Promise<void> {
  await page.goto(link);
  await expect(page.getByRole('heading', { level: 1, name: /^Join / })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in to join' }).click();
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /^Continue( with email)?$/ }).click();
  await expect(page).toHaveURL(/\/verify/);
  await page.getByLabel('Code').fill(await codeFor(page.request, email));
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await page.getByRole('button', { name: 'Join workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/`), { timeout: 20_000 });
}

test.describe('teams and access', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Settings run at desktop width.');

  test('an owner makes, renames, fills and deletes a team, and Undo brings it back', async ({ page }, info) => {
    test.setTimeout(180_000);
    const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
    const slug = `teams-${tag}`;
    await newWorkspace(page, `ada-${tag}@example.com`, slug);

    await page.goto(`/w/${slug}/settings/teams`);
    await expect(page.getByRole('heading', { level: 1, name: 'Teams' })).toBeVisible();
    // Nothing yet: one way forward.
    await expect(page.getByText('No teams yet')).toBeVisible();
    await checkScreen(page, 'teams-empty');
    await page.getByRole('button', { name: 'New team' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New team' });
    await dialog.getByLabel('Name', { exact: true }).fill('Sales');
    await dialog.getByRole('button', { name: 'People' }).click();
    await page.getByRole('option', { name: /Ada Lovelace/ }).click();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Create team' }).click();
    await expect(page.getByText('Sales created.')).toBeVisible();
    const grid = page.getByRole('grid', { name: 'Teams' });
    await expect(grid.getByRole('rowheader', { name: 'Sales' })).toBeVisible();
    await expect(grid.getByRole('group', { name: '1 person in Sales' })).toBeVisible();
    await checkScreen(page, 'teams-list');

    // The same name is refused in the dialog, on its field.
    await page.getByRole('button', { name: 'New team' }).first().click();
    const again = page.getByRole('dialog', { name: 'New team' });
    await again.getByLabel('Name', { exact: true }).fill('sales');
    await again.getByRole('button', { name: 'Create team' }).click();
    await expect(again.getByText('Another team has that name. Pick another.')).toBeVisible();
    await again.getByRole('button', { name: 'Cancel' }).click();

    // Rename it from its name.
    await grid.getByRole('button', { name: 'Sales' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit Sales' });
    await edit.getByLabel('Name', { exact: true }).fill('Revenue');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Revenue saved.')).toBeVisible();
    await expect(grid.getByRole('rowheader', { name: 'Revenue' })).toBeVisible();

    // A delete is one click, and Undo makes the same team again with the same person.
    await grid.getByRole('button', { name: 'Delete Revenue' }).click();
    await expect(page.getByText('Revenue deleted.')).toBeVisible();
    await expect(page.getByText('No teams yet')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Revenue is back.')).toBeVisible();
    await expect(grid.getByRole('rowheader', { name: 'Revenue' })).toBeVisible();
    await expect(grid.getByRole('group', { name: '1 person in Revenue' })).toBeVisible();
  });

  test('Deals goes to the Sales team only, a member outside it loses Deals, and a member reads the rest', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(300_000);
    const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
    const slug = `access-${tag}`;
    const grace = `grace-${tag}@example.com`;
    await newWorkspace(page, `ada-${tag}@example.com`, slug);

    // The owner invites a member and makes a Sales team to put them in later.
    await page.goto(`/w/${slug}/settings/members`);
    await page.getByRole('button', { name: 'Invite people' }).first().click();
    const invite = page.getByRole('dialog', { name: 'Invite people' });
    await invite.getByRole('textbox', { name: 'Email' }).fill(grace);
    await invite.getByRole('button', { name: /^Invite/ }).click();
    // A clean invite closes the dialog by itself.
    await expect(invite).toHaveCount(0);
    const link = await inviteLinkFor(page.request, grace);
    const memberContext = await browser.newContext();
    const member = await memberContext.newPage();
    await joinThrough(member, link, grace, slug);

    await page.goto(`/w/${slug}/settings/teams`);
    await page.getByRole('button', { name: 'New team' }).first().click();
    const made = page.getByRole('dialog', { name: 'New team' });
    await made.getByLabel('Name', { exact: true }).fill('Sales');
    await made.getByRole('button', { name: 'Create team' }).click();
    await expect(page.getByText('Sales created.')).toBeVisible();

    // Deals' Access tab: everyone edits until the owner says otherwise, and the line says so.
    await page.goto(`/w/${slug}/settings/objects/deals/access`);
    await expect(page.getByText('Everyone can edit Deals.')).toBeVisible();
    await checkScreen(page, 'access-default');
    const grid = page.getByRole('grid', { name: 'Who can do what' });
    // Owners and admins are always in, and never a control to change.
    await expect(grid.getByRole('checkbox', { name: 'Can see, owners and admins' })).toBeDisabled();
    // Members lose Deals.
    await grid.getByRole('checkbox', { name: 'Can see, Members' }).uncheck();
    await expect(page.getByText('Members can’t see Deals.')).toBeVisible();
    // The Sales team gets it back, and the line names who.
    await page.getByRole('button', { name: 'Add team' }).click();
    await page.getByRole('menuitem', { name: 'Sales' }).click();
    await expect(page.getByText('Sales can edit Deals. Other members can’t see them.')).toBeVisible();
    await checkScreen(page, 'access-sales');
    // It is kept: a reload shows the same grid.
    await page.reload();
    await expect(page.getByText('Sales can edit Deals. Other members can’t see them.')).toBeVisible();

    // The member is in no team: Deals is not in their sidebar (hidden means absent, not locked).
    await member.goto(`/w/${slug}/home`);
    const sidebar = member.getByRole('navigation', { name: 'Main navigation' });
    await expect(sidebar.getByRole('link', { name: 'People', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Deals', exact: true })).toHaveCount(0);

    // The owner puts them in Sales; after a reload they have Deals.
    await page.goto(`/w/${slug}/settings/teams`);
    await page.getByRole('grid', { name: 'Teams' }).getByRole('button', { name: 'Sales' }).click();
    const fill = page.getByRole('dialog', { name: 'Edit Sales' });
    await fill.getByRole('button', { name: 'People' }).click();
    await page.getByRole('option', { name: /grace/i }).click();
    await page.keyboard.press('Escape');
    await fill.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Sales saved.')).toBeVisible();
    await member.reload();
    await expect(sidebar.getByRole('link', { name: 'Deals', exact: true })).toBeVisible({ timeout: 15_000 });

    // A member reads Teams with no way to change them, and the Access tab's address says it is not theirs.
    await member.goto(`/w/${slug}/settings/teams`);
    await expect(member.getByRole('rowheader', { name: 'Sales' })).toBeVisible();
    await expect(member.getByRole('button', { name: 'New team' })).toHaveCount(0);
    await member.goto(`/w/${slug}/settings/objects/people/access`);
    await expect(member.getByText('Only owners and admins set access')).toBeVisible();

    await memberContext.close();
  });

  test('hiding a field says who loses it, the member’s table drops the column live, and Preview as shows their view', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(300_000);
    const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
    const slug = `fields-${tag}`;
    const grace = `grace-${tag}@example.com`;
    await newWorkspace(page, `ada-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/settings/members`);
    await page.getByRole('button', { name: 'Invite people' }).first().click();
    const invite = page.getByRole('dialog', { name: 'Invite people' });
    await invite.getByRole('textbox', { name: 'Email' }).fill(grace);
    await invite.getByRole('button', { name: /^Invite/ }).click();
    // A clean invite closes the dialog by itself.
    await expect(invite).toHaveCount(0);
    const memberContext = await browser.newContext();
    const member = await memberContext.newPage();
    await joinThrough(member, await inviteLinkFor(page.request, grace), grace, slug);

    // The member has Deals open, with its Value column.
    await member.goto(`/w/${slug}/objects/deals`);
    const memberGrid = member.getByRole('grid').first();
    await expect(memberGrid.getByRole('columnheader', { name: /Value/ })).toBeVisible({ timeout: 30_000 });

    // The owner opens Deals' Access tab: Fields is folded away until asked for.
    await page.goto(`/w/${slug}/settings/objects/deals/access`);
    const fields = page.getByRole('button', { name: 'Fields' });
    await expect(fields).toHaveAttribute('aria-expanded', 'false');
    await fields.click();
    // The record's name always shows: its picker offers no Hidden.
    await page.getByRole('button', { name: /Name for Members/ }).click();
    await expect(page.getByRole('option', { name: 'Hidden' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await checkScreen(page, 'access-fields');

    // Value is hidden from Members: one person loses it, said as chips, with Undo.
    await page.getByRole('button', { name: /Value for Members/ }).click();
    await page.getByRole('option', { name: 'Hidden' }).click();
    const less = page.getByRole('status').filter({ hasText: 'Less access' });
    await expect(less.getByText('1 person')).toBeVisible();
    // Undo is the toast's, not a question first.
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await checkScreen(page, 'access-less');
    // The member's open table drops the column with no reload (AC-852).
    await expect(memberGrid.getByRole('columnheader', { name: /Value/ })).toHaveCount(0, { timeout: 15_000 });

    // Preview as the member: a read only banner with an Exit, and no Value among their fields.
    await page.getByRole('button', { name: 'Preview as' }).click();
    await page.getByRole('menuitem', { name: /Grace/ }).click();
    const banner = page.getByRole('status').filter({ hasText: /Previewing as / });
    await expect(banner.getByText('Can edit')).toBeVisible();
    await expect(banner).not.toContainText('Value');
    await expect(banner).toContainText('Name');
    await checkScreen(page, 'access-preview');
    await banner.getByRole('button', { name: 'Exit preview' }).click();
    await expect(page.getByText(/^Previewing as /)).toHaveCount(0);

    // Undo brings the column back for the member.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(memberGrid.getByRole('columnheader', { name: /Value/ })).toBeVisible({ timeout: 15_000 });
    await memberContext.close();
  });
});
