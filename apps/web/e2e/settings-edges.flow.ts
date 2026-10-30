// The settings journey's edges (flow pass, 30 October 2026): a new attribute named like an archived one is made
// with a free API name, or the archived one restored instead; Hide from sidebar says so with Undo, and the
// sidebar draws no Favourites (owner, 30 October 2026); archiving an object or an attribute toasts with Undo; an
// object's settings open its records; and the Invite dialog copies the invite link, turning it on when off.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

/** A new workspace of its own, its slug back. */
async function fresh(page: Page, name: string): Promise<string> {
  const tag = randomUUID().slice(0, 8);
  const slug = `${name}-${tag}`;
  await newWorkspace(page, `${name}-${tag}@example.com`, slug);
  return slug;
}

/** Archives one of Deals' attributes from its row menu, through the confirm. */
async function archiveAttribute(page: Page, title: string): Promise<void> {
  await page
    .getByRole('grid', { name: 'Attributes' })
    .getByRole('button', { name: `Actions for ${title}` })
    .click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page
    .getByRole('alertdialog', { name: `Archive ${title}?` })
    .getByRole('button', { name: `Archive ${title}` })
    .click();
  await expect(page.getByText(`${title} archived.`)).toBeVisible();
}

test.describe('the settings journey’s edges', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Settings and the sidebar run at desktop width.');

  test('a name an archived attribute holds is made with a free API name, or the archived one restored', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const slug = await fresh(page, 'attrname');
    await page.goto(`/w/${slug}/settings/objects/deals/attributes`);
    await page.getByRole('button', { name: 'New attribute' }).click();
    let dialog = page.getByRole('dialog', { name: 'New attribute' });
    await dialog.getByLabel('Name', { exact: true }).fill('Price');
    await dialog.getByRole('button', { name: 'Create attribute' }).click();
    await expect(page.getByText('Price added.')).toBeVisible();

    // Archived, its toast offers Undo (the same restore as the Archived section's), then archived again.
    await archiveAttribute(page, 'Price');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Price restored.')).toBeVisible();
    await archiveAttribute(page, 'Price');

    // A new Price: a quiet way to restore the archived one instead (Create would take price_2).
    await page.getByRole('button', { name: 'New attribute' }).click();
    dialog = page.getByRole('dialog', { name: 'New attribute' });
    await dialog.getByLabel('Name', { exact: true }).fill('Price');
    // Restore it brings the archived one back instead, and closes the dialog.
    await dialog.getByRole('button', { name: 'Restore the archived Price' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Price restored.')).toBeVisible();
    await expect(page.getByRole('grid', { name: 'Attributes' }).getByRole('row', { name: /Price/ })).toHaveCount(1);

    // Archived once more, a new Price is made beside it with price_2.
    await archiveAttribute(page, 'Price');
    await page.getByRole('button', { name: 'New attribute' }).click();
    dialog = page.getByRole('dialog', { name: 'New attribute' });
    await dialog.getByLabel('Name', { exact: true }).fill('Price');
    await dialog.getByRole('button', { name: 'Create attribute' }).click();
    await expect(page.getByText('Price added.')).toBeVisible();
  });

  test('Hide from sidebar says so with Undo, and the sidebar draws no Favourites', async ({ page }) => {
    test.setTimeout(120_000);
    const slug = await fresh(page, 'sidehide');
    await page.goto(`/w/${slug}/home`);
    await expect(nav(page).getByRole('button', { name: 'Records', exact: true })).toBeVisible();
    await expect(nav(page).getByRole('button', { name: 'Favourites', exact: true })).toHaveCount(0);

    const deals = nav(page).getByRole('link', { name: 'Deals', exact: true });
    await deals.hover();
    await nav(page).getByRole('button', { name: 'More for Deals' }).click();
    await page.getByRole('menuitem', { name: 'Hide from sidebar' }).click();
    await expect(deals).toHaveCount(0);
    await expect(page.getByText('Deals hidden from sidebar')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(deals).toBeVisible();
    // Kept for the member: a reload still shows it.
    await page.reload();
    await expect(nav(page).getByRole('link', { name: 'Deals', exact: true })).toBeVisible();
  });

  test('a new object’s settings open its records, and archiving it from the list toasts with Undo', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const slug = await fresh(page, 'objopen');
    await page.goto(`/w/${slug}/settings/objects`);
    // The Records column counts each object's records in one read.
    await expect(page.getByRole('columnheader', { name: 'Records' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Deals/ })).toContainText('0 records');

    await page.getByRole('button', { name: 'New object' }).first().click();
    const create = page.getByRole('dialog', { name: 'New object' });
    await create.getByLabel('Name', { exact: true }).fill('Project');
    await create.getByRole('button', { name: 'Create object' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await page.getByRole('link', { name: 'Open Projects' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/projects`));
    await expect(page.getByRole('grid', { name: 'Projects' })).toBeVisible();

    await page.goto(`/w/${slug}/settings/objects`);
    await page.getByRole('button', { name: 'Actions for Projects' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await page
      .getByRole('alertdialog', { name: 'Archive Projects?' })
      .getByRole('button', { name: 'Archive Projects' })
      .click();
    await expect(page.getByText('Projects archived.')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Projects restored.')).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
  });

  test('the Invite dialog copies the invite link, turning it on when off, with Undo', async ({ page, context }) => {
    test.setTimeout(120_000);
    const slug = await fresh(page, 'invlink');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/w/${slug}/settings/members`);
    await page.getByRole('button', { name: 'Invite people' }).first().click();
    const invite = page.getByRole('dialog', { name: 'Invite people' });
    // Off at first: one press turns it on as a Member link and copies it, no question asked.
    await invite.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(page.getByText('Link on and copied.', { exact: false })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/\/invite\/[\w-]+$/);
    // Undo turns it off again; the next press turns it on afresh.
    await page.getByRole('button', { name: 'Undo' }).click();
    await invite.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(page.getByText('Link on and copied.', { exact: false })).toBeVisible();
    // On, a press only copies.
    await invite.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(page.getByText('Link copied.')).toBeVisible();
  });
});
