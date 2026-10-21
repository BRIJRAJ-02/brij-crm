// Saved views (spec 0020, milestone 1), end to end with two browsers: People
// opens its default view; a filter built in the Toolbar's builder sits as a
// draft in the address bar until Save, and a second browser on the same view
// follows the save live; a draft link opens the same draft elsewhere; and a
// save over a change made since the draft began opens the clash dialog,
// where Replace saves it (AC-462, AC-464, AC-466, AC-468, AC-469, AC-489).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace, objectUrl, signInAgain } from './people.ts';

/**
 * Whether live updates reach the browsers: Centrifugo admits only the app on :5173, so a run on another port
 * (`FLOW_LIVE=off`) reloads the second browser where it would otherwise watch the change arrive.
 */
const LIVE = process.env.FLOW_LIVE !== 'off';

/** The People grid. */
const grid = (page: Page) => page.getByRole('grid', { name: 'People' });

/** Builds "Email addresses contains <text>" in the Toolbar's filter builder, and closes it. */
async function filterEmails(page: Page, text: string): Promise<void> {
  await page
    .getByRole('toolbar', { name: 'View options' })
    .getByRole('button', { name: 'Filter', exact: true })
    .click();
  const builder = page.getByRole('dialog', { name: 'Filters' });
  await builder.getByRole('button', { name: 'Add filter', exact: true }).click();
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

    // Discard asks first, naming the view; Cancel keeps the draft.
    await toolbar.getByRole('button', { name: 'Discard changes' }).click();
    const discard = writer.getByRole('alertdialog', { name: /^Discard changes to / });
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Cancel' }).click();
    await expect(discard).toBeHidden();
    await expect(writer).toHaveURL(/\?draft=/);

    // The reader still sees everyone until the writer saves; then follows within moments (AC-468).
    await expect(grid(reader).getByText('Alan Turing', { exact: true })).toBeVisible();
    await toolbar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(writer).not.toHaveURL(/draft=/);
    await expect(toolbar.getByRole('button', { name: 'Discard changes' })).toBeHidden();
    if (!LIVE) await reader.reload();
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

    // The writer narrows its draft further and saves first; the reader's save of the older draft is never
    // silent (AC-469). The writer's save differs from the reader's draft, so following it live leaves the reader
    // a draft of its own.
    await filterEmails(writer, `grace-${tag}`);
    await expect(grid(writer).getByText('Grace Hopper', { exact: true })).toBeVisible();
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

  test('the view bar ends with View settings then Table or Board, and on a board View settings adds an attribute', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `viewbar-${tag}`;
    await newWorkspace(page, `viewbar-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/deals`);
    await expect(page).toHaveURL(objectUrl(slug, 'deals'));
    // One line (the owner, 22 October 2026): View settings is the bar's one button, the switch the same height.
    const settings = page.getByRole('button', { name: 'View settings' });
    const layout = page.getByRole('radiogroup', { name: 'Layout' });
    const button = await settings.boundingBox();
    const segmented = await layout.boundingBox();
    expect(Math.abs((button?.height ?? 0) - (segmented?.height ?? 1))).toBeLessThan(1);
    expect(Math.abs((button?.y ?? 0) - (segmented?.y ?? 1))).toBeLessThan(1);

    // Board: View settings lists the card's fields, with Add attribute at its foot.
    await layout.getByRole('radio', { name: 'Board' }).click({ force: true });
    await expect(page.getByRole('radio', { name: 'Board' })).toBeChecked();
    await settings.click();
    const dialog = page.getByRole('dialog', { name: 'View settings' });
    await expect(dialog.getByRole('grid', { name: 'Card fields' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Add attribute' }).click();
    const addDialog = page.getByRole('dialog', { name: 'New attribute' });
    await expect(addDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(addDialog).toBeHidden();
    await expect(settings).toBeFocused();
  });
});
