// The People table (spec 0005, milestone 2): add a column, create people,
// edit cells, and see refusals in place. Signs a new person in through
// Mailpit, names the workspace, then works the table by pointer and keyboard.
// Every state it reaches is checked with axe (WCAG A and AA, contrast
// included) in light and in dark. Set FLOW_SCREENSHOTS to a folder to keep a
// light and a dark picture of each, per project. Verifies AC-34 to AC-37.
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { codeFor } from './mailpit.ts';

const SHOTS = process.env.FLOW_SCREENSHOTS;
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

/** axe, once its script is on the page (sign-in.flow.ts declares it on Window). */
interface Axe {
  readonly run: (
    context: unknown,
    options: unknown,
  ) => Promise<{ violations: { id: string; help: string; nodes: { html: string }[] }[] }>;
}

/** The page's WCAG A and AA violations, as `rule (help): elements` lines. */
async function violations(page: Page): Promise<string[]> {
  const hasAxe = () => (globalThis as unknown as { axe?: Axe }).axe !== undefined;
  if (!(await page.evaluate(hasAxe))) await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const result = await (globalThis as unknown as { axe?: Axe }).axe?.run(
      { exclude: [['[data-live-announcer]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } },
    );
    return (result?.violations ?? []).map(
      (violation) => `${violation.id} (${violation.help}): ${violation.nodes.map((node) => node.html).join(', ')}`,
    );
  });
}

/** No axe violations in light and in dark, and a picture of each when FLOW_SCREENSHOTS asks. */
async function checkScreen(page: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'));
    expect(await violations(page), `${name} in ${scheme}`).toEqual([]);
    if (SHOTS !== undefined) {
      await page.screenshot({ path: path.join(SHOTS, `${test.info().project.name}-${name}-${scheme}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/** Signs a new person in through Mailpit and makes their workspace, landing on its People page. */
async function newWorkspace(page: Page, email: string, slug: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/verify/);
  await page.getByLabel('Code').fill(await codeFor(page.request, email));
  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByLabel('Your name').fill('Ada Lovelace');
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people$`));
}

/**
 * Scrolls the grid sideways until a column's header is drawn (columns past
 * the first dozen are virtualised), and answers its place in the row.
 */
async function showColumn(page: Page, column: string): Promise<number> {
  const grid = page.getByRole('grid', { name: 'People' });
  await grid.evaluate((element) => {
    element.scrollLeft = 0;
  });
  for (let step = 0; step < 40; step += 1) {
    const header = grid.getByRole('columnheader', { name: new RegExp(column) });
    if ((await header.count()) > 0) {
      await header.scrollIntoViewIfNeeded();
      return Number(await header.getAttribute('aria-colindex')) - 1;
    }
    await grid.evaluate((element) => {
      element.scrollLeft += 300;
    });
    await page.waitForTimeout(50);
  }
  throw new Error(`No "${column}" column.`);
}

/** The grid cell at a row (0 based, records only) and a column header's name, scrolled into view. */
async function cellAt(page: Page, row: number, column: string) {
  const col = await showColumn(page, column);
  return page.getByRole('grid', { name: 'People' }).locator(`[data-cell="${String(row)}:${String(col)}"]`);
}

/** Adds a person through "New person": first and last name, and an email; waits for the row and its focus. */
async function addPerson(page: Page, first: string, last: string, email: string): Promise<void> {
  await page.getByRole('button', { name: 'New person' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New person' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('First name').fill(first);
  await dialog.getByLabel('Last name').fill(last);
  await dialog.getByLabel('Email addresses').fill(email);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('the People table', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('adds a column, creates people, edits cells, and shows refusals in place', async ({ page }) => {
    const tag = randomUUID().slice(0, 8);
    await newWorkspace(page, `people-${tag}@example.com`, `people-${tag}`);

    // Empty: the columns stay, with "New person" in the empty state and the top bar (AC-34).
    const grid = page.getByRole('grid', { name: 'People' });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: /Email addresses/ })).toBeVisible();
    await expect(page.getByText('No people yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New person' })).toHaveCount(2);
    await checkScreen(page, '1-people-empty');

    // Add attribute: a name and a type; the column appears once the server agrees (AC-37).
    const columnsBefore = Number(await grid.getAttribute('aria-colcount'));
    await page.getByRole('button', { name: 'Add attribute' }).click();
    const addDialog = page.getByRole('dialog', { name: 'Add attribute' });
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel('Name').fill('Nickname');
    await checkScreen(page, '2-add-attribute');
    await addDialog.getByRole('button', { name: 'Add attribute' }).click();
    await expect(addDialog).toBeHidden();
    await expect.poll(async () => Number(await grid.getAttribute('aria-colcount'))).toBe(columnsBefore + 1);
    await showColumn(page, 'Nickname');

    // The same name again is refused inline, on the name field.
    await page.getByRole('button', { name: 'Add attribute' }).click();
    await addDialog.getByLabel('Name').fill('Nickname');
    await addDialog.getByRole('button', { name: 'Type' }).click();
    await page.getByRole('option', { name: 'Number' }).click();
    await addDialog.getByRole('button', { name: 'Add attribute' }).click();
    await expect(addDialog.getByText('An attribute with this name exists.')).toBeVisible();
    await checkScreen(page, '3-add-attribute-taken');
    await addDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(addDialog).toBeHidden();

    // New person: the row shows and takes focus (AC-35).
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
    const first = await cellAt(page, 0, 'Name');
    await expect(first).toContainText('Grace Hopper');
    await expect(first).toBeFocused();
    await addPerson(page, 'Alan', 'Turing', `alan-${tag}@example.com`);
    await expect(await cellAt(page, 1, 'Name')).toBeFocused();

    // A refused create keeps the dialog open with the message on its field, and no row.
    await page.getByRole('button', { name: 'New person' }).first().click();
    const newDialog = page.getByRole('dialog', { name: 'New person' });
    await newDialog.getByLabel('First name').fill('Grace');
    await newDialog.getByLabel('Email addresses').fill(`grace-${tag}@example.com`);
    await newDialog.getByRole('button', { name: 'Create' }).click();
    await expect(newDialog.getByText(/already|unique|taken/i).first()).toBeVisible();
    await checkScreen(page, '4-new-person-refused');
    await newDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(grid).toHaveAttribute('aria-rowcount', '3');

    // Edit a cell: it shows at once and stays after a reload (AC-36).
    const jobTitle = await cellAt(page, 0, 'Job title');
    await jobTitle.click();
    await page.keyboard.type('Rear admiral');
    await page.keyboard.press('Enter');
    await expect(jobTitle).toContainText('Rear admiral');
    const nickname = await cellAt(page, 1, 'Nickname');
    await nickname.dblclick();
    await page.keyboard.type('Prof');
    await page.keyboard.press('Enter');
    await expect(nickname).toContainText('Prof');
    await checkScreen(page, '5-people-edited');

    // A refused edit rolls back, marks the cell and raises a toast with Retry.
    const email = await cellAt(page, 1, 'Email addresses');
    await email.click();
    await page.keyboard.press('Enter');
    const editor = page.getByLabel('Add Email addresses…');
    await editor.fill(`grace-${tag}@example.com`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByText(/already has this Email addresses/).first()).toBeVisible();
    await expect(email).not.toContainText(`grace-${tag}@example.com`);
    await checkScreen(page, '6-edit-refused');

    await page.reload();
    await expect(await cellAt(page, 0, 'Job title')).toContainText('Rear admiral');
    await expect(await cellAt(page, 1, 'Nickname')).toContainText('Prof');
    await expect(await cellAt(page, 1, 'Name')).toContainText('Alan Turing');
  });
});
