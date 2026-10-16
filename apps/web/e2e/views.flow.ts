// Saved views (spec 0020, milestone 1), end to end with two browsers: People
// opens its default view; a filter built in the Toolbar's builder sits as a
// draft in the address bar until Save, and a second browser on the same view
// follows the save live; a draft link opens the same draft elsewhere; and a
// save over a change made since the draft began opens the clash dialog,
// where Replace saves it (AC-462, AC-464, AC-466, AC-468, AC-469, AC-489).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace, objectUrl, signInAgain } from './people.ts';

/** The People grid. */
const grid = (page: Page) => page.getByRole('grid', { name: 'People' });

/** Builds "Email addresses contains <text>" in the Toolbar's filter builder, and closes it. */
async function filterEmails(page: Page, text: string): Promise<void> {
  await page
    .getByRole('toolbar', { name: 'View options' })
    .getByRole('button', { name: 'Filter', exact: true })
    .click();
  const builder = page.getByRole('dialog', { name: 'Filters' });
  await builder.getByRole('button', { name: 'Add filter' }).click();
  await page.getByRole('menuitem', { name: 'Email addresses' }).click();
  await builder.getByRole('button', { name: 'is', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'contains', exact: true }).click();
  await builder.getByRole('textbox').last().fill(text);
  await page.keyboard.press('Escape');
  await expect(builder).toBeHidden();
}

test.describe('saved views', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('a filter drafted in one browser is saved for a second, a draft link reopens, and a clash asks first', async ({
    browser,
    page: writer,
  }, testInfo) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const email = `views-${tag}@example.com`;
    const slug = `views-${tag}`;
    const code = await newWorkspace(writer, email, slug);
    // People's address opened its default view (AC-462).
    await expect(writer).toHaveURL(objectUrl(slug, 'people'));
    const viewUrl = writer.url();
    await expect(writer.getByRole('button', { name: 'All People' })).toBeVisible();
    await addPerson(writer, 'Grace', 'Hopper', `grace-${tag}@acme.com`);
    await addPerson(writer, 'Alan', 'Turing', `alan-${tag}@bletchley.org`);
    await expect(grid(writer).getByText('Alan Turing', { exact: true })).toBeVisible();

    // The second browser: the same view, no draft.
    const readerContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: testInfo.project.use.viewport ?? null,
    });
    const reader = await readerContext.newPage();
    await signInAgain(reader, email, new URL(viewUrl).pathname, [code]);
    await expect(grid(reader).getByText('Alan Turing', { exact: true })).toBeVisible();

    // The writer drafts a filter: the URL carries it, the rows narrow, Save and Discard show (AC-464, AC-466).
    await filterEmails(writer, 'acme');
    await expect(writer).toHaveURL(/\?draft=[A-Za-z0-9_-]+$/);
    await expect(grid(writer).getByText('Alan Turing', { exact: true })).toBeHidden();
    await expect(grid(writer).getByText('Grace Hopper', { exact: true })).toBeVisible();
    const toolbar = writer.getByRole('toolbar', { name: 'View options' });
    await expect(toolbar.getByRole('button', { name: 'Discard changes' })).toBeVisible();
    await checkScreen(writer, 'views-draft');

    // A reload keeps the draft (AC-466).
    await writer.reload();
    await expect(grid(writer).getByText('Grace Hopper', { exact: true })).toBeVisible();
    await expect(grid(writer).getByText('Alan Turing', { exact: true })).toBeHidden();

    // The reader still sees everyone until the writer saves; then follows within moments (AC-468).
    await expect(grid(reader).getByText('Alan Turing', { exact: true })).toBeVisible();
    await toolbar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(writer).not.toHaveURL(/draft=/);
    await expect(toolbar.getByRole('button', { name: 'Discard changes' })).toBeHidden();
    await expect(grid(reader).getByText('Alan Turing', { exact: true })).toBeHidden({ timeout: 10_000 });
    await expect(grid(reader).getByText('Grace Hopper', { exact: true })).toBeVisible();

    // A draft link opens the same draft in the other browser (AC-466).
    await filterEmails(writer, 'grace');
    await expect(writer).toHaveURL(/\?draft=/);
    const link = writer.url();
    await reader.goto(link);
    await expect(
      reader.getByRole('toolbar', { name: 'View options' }).getByRole('button', { name: 'Discard changes' }),
    ).toBeVisible();

    // The writer saves its draft first; the reader's save of the older draft is never silent (AC-469).
    await toolbar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(writer).not.toHaveURL(/draft=/);
    await reader
      .getByRole('toolbar', { name: 'View options' })
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    const dialog = reader.getByRole('dialog', { name: 'This view changed' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('changed this view’s filters since you started.');
    await checkScreen(reader, 'views-changed');
    await dialog.getByRole('button', { name: 'Replace' }).click();
    await expect(dialog).toBeHidden();
    await expect(reader).not.toHaveURL(/draft=/);

    // An unreadable draft is ignored with a toast, and the saved view shows (AC-467).
    await reader.goto(`${new URL(viewUrl).pathname}?draft=bm90LWEtcXVlcnk`);
    await expect(reader.getByText('That link’s filter couldn’t be read, so the saved view is shown.')).toBeVisible();
    await expect(reader).not.toHaveURL(/draft=/);
    await readerContext.close();
  });
});
