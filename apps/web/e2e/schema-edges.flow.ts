// The schema's edges (flow pass, 30 October 2026): a request to join reaches the inbox of whoever can approve it; a
// new object's Stage, Owner and Priority start as a status, a member and a select; the grid's "+" offers a hidden
// column before a new one; a relationship can make the object it points to, and Back keeps the name; an option
// records hold says so, and its Archive asks where they go, with Undo; and Type follows the name until picked.
// Timestamp in the type picker (item 6) is not built: the engine writes timestamps for the system alone.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { codeFor } from './mailpit.ts';
import { newWorkspace } from './people.ts';

test.describe('the schema’s edges', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Settings and the grid run at desktop width.');

  test('a request to join reaches the owner’s inbox and opens Members, where Approve is', async ({ page, browser }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const domain = `acme-${tag}.test`;
    const slug = `joinask-${tag}`;
    await newWorkspace(page, `owner-${tag}@${domain}`, slug);
    await page.goto(`/w/${slug}/settings/members`);
    await page.getByRole('tab', { name: /Joining/ }).click();
    await page.getByRole('switch', { name: 'Company email' }).click();
    await expect(page.getByText(`People at @${domain} can now ask to join.`)).toBeVisible();

    // Someone at the same domain asks, in a browser of their own.
    const asker = await browser.newContext();
    const other = await asker.newPage();
    const email = `bea-${tag}@${domain}`;
    await other.goto('/join');
    await expect(other).toHaveURL(/\/sign-in\?redirect=/);
    await other.getByLabel('Email').fill(email);
    await other.getByRole('button', { name: /^Continue( with email)?$/ }).click();
    await other.getByLabel('Code').fill(await codeFor(other.request, email));
    await other
      .getByRole('button', { name: /^Ask to join/ })
      .first()
      .click();
    await asker.close();

    // The owner hears of it in the app, not only by email, and the row opens where Approve is.
    await page.goto(`/w/${slug}/inbox`);
    const row = page.getByRole('row').filter({ hasText: 'asks to join' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/settings/members`));
    await expect(page.getByRole('button', { name: /^Approve/ }).first()).toBeVisible();
  });

  test('a new object’s Stage, Owner and Priority start typed, not as text', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `starters-${tag}`;
    await newWorkspace(page, `starters-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/settings/objects`);
    await page.getByRole('button', { name: 'New object' }).first().click();
    const create = page.getByRole('dialog', { name: 'New object' });
    await create.getByLabel('Name', { exact: true }).fill('Ticket');
    // The starters a ticket suggests, picked one after another.
    for (const title of ['Priority', 'Subject']) {
      await create.getByRole('button', { name: title, exact: true }).click();
    }
    await create.getByRole('button', { name: 'Create object' }).click();
    await expect(create).toBeHidden();
    const attributes = page.getByRole('grid', { name: 'Attributes' });
    await expect(attributes.getByRole('row').filter({ hasText: 'Priority' })).toContainText('Select');
    await attributes.getByRole('row').filter({ hasText: 'Priority' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit attribute' });
    for (const level of ['Low', 'Medium', 'High']) {
      await expect(edit.getByRole('textbox', { name: new RegExp(level) }).first()).toBeVisible();
    }
  });

  test('the grid’s "+" offers a hidden column first, so it never comes back as a duplicate', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `plushidden-${tag}`;
    await newWorkspace(page, `plushidden-${tag}@example.com`, slug);
    const grid = page.getByRole('grid', { name: 'People' });
    await expect(grid).toBeVisible();
    const header = grid.getByRole('columnheader').nth(2);
    const title = ((await header.textContent()) ?? '').trim();
    await grid.getByRole('button', { name: `${title} options` }).click();
    await page.getByRole('menuitem', { name: 'Hide' }).click();
    await expect(grid.getByRole('columnheader', { name: title })).toHaveCount(0);

    await grid.getByRole('columnheader').getByRole('button', { name: 'Add attribute' }).click();
    await expect(page.getByRole('menuitem', { name: 'New attribute…' })).toBeVisible();
    await page.getByRole('menuitem', { name: title }).click();
    await expect(grid.getByRole('columnheader', { name: title })).toHaveCount(1);
  });

  test('a relationship can make the object it points to, and Back keeps the name', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `relnew-${tag}`;
    await newWorkspace(page, `relnew-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/settings/objects/companies/attributes`);
    await page.getByRole('button', { name: 'New attribute' }).click();
    const dialog = page.getByRole('dialog', { name: 'New attribute' });
    await dialog.getByLabel('Name', { exact: true }).fill('Suppliers');
    await dialog.getByRole('button', { name: /^Type/ }).click();
    await page.getByRole('option', { name: 'Relationship' }).click();

    // Back returns to the attribute form with the name kept.
    const step = page.getByRole('dialog', { name: 'New relationship' });
    await step.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('dialog', { name: 'New attribute' }).getByLabel('Name', { exact: true })).toHaveValue(
      'Suppliers',
    );
    await page.getByRole('dialog', { name: 'New attribute' }).getByRole('button', { name: /^Type/ }).click();
    await page.getByRole('option', { name: 'Relationship' }).click();

    // The related object doesn't exist yet: New object… makes it and comes back with it chosen.
    await step.getByRole('button', { name: /^Related object/ }).click();
    await page.getByRole('option', { name: 'New object…' }).click();
    const create = page.getByRole('dialog', { name: 'New object' });
    await create.getByLabel('Name', { exact: true }).fill('Vendor');
    await create.getByRole('button', { name: 'Create object' }).click();
    await expect(create).toBeHidden();
    await expect(step.getByRole('button', { name: /^Related object/ })).toContainText('Vendors');
    await step.getByRole('button', { name: 'Create relationship' }).click();
    await expect(step).toBeHidden();
  });

  test('an option records hold says how many, and its Archive asks where they go, with Undo', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `optcount-${tag}`;
    await newWorkspace(page, `optcount-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/deals`);
    await page.getByRole('button', { name: 'New deal' }).first().click();
    const record = page.getByRole('dialog', { name: 'New deal' });
    await record.getByLabel('Name', { exact: true }).fill('Apollo');
    await record.getByRole('button', { name: 'Create' }).click();
    await expect(record).toBeHidden();

    await page.goto(`/w/${slug}/settings/objects/deals/attributes`);
    await page.getByRole('grid', { name: 'Attributes' }).getByRole('row').filter({ hasText: 'Stage' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit attribute' });
    await expect(edit.getByText('1 record', { exact: true })).toBeVisible();
    const held = edit.getByRole('row').filter({ hasText: '1 record' });
    await held.getByRole('button', { name: /^Actions for/ }).click();
    await expect(page.getByRole('menuitem', { name: /^Archive, move records to/ }).first()).toBeVisible();
    await page.getByRole('menuitem', { name: 'Archive, leave 1 record on it' }).click();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  test('Type follows the name until the person picks one', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `typefollow-${tag}`;
    await newWorkspace(page, `typefollow-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/settings/objects/people/attributes`);
    await page.getByRole('button', { name: 'New attribute' }).click();
    const dialog = page.getByRole('dialog', { name: 'New attribute' });
    const type = dialog.getByRole('button', { name: /^Type/ });
    await dialog.getByLabel('Name', { exact: true }).fill('Work email');
    await expect(type).toContainText('Email');
    await dialog.getByLabel('Name', { exact: true }).fill('Due date');
    await expect(type).toContainText('Date');
    // Picked, it stays whatever the name says.
    await type.click();
    await page.getByRole('option', { name: 'Text', exact: true }).click();
    await dialog.getByLabel('Name', { exact: true }).fill('Renewal date');
    await expect(type).toContainText('Text');
  });
});
