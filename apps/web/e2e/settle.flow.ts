// Settle on People (spec 0006, AC-56, AC-57): two browsers of one person on
// one workspace, the table sorted by Job title from the column menu.
// - Someone else changes a job title so it sorts last: the new value shows
//   in place at once, and the row moves to the end about 1.5 seconds later.
// - The person's own change keeps the row where they see it.
// - A record made here sits first, noted New, whatever the sort says.
// Locally: `pnpm dev:apps` (live updates on) against a throwaway database.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, cellAt, checkScreen, newWorkspace, signInAgain } from './people.ts';

/** The names down the Name column, top to bottom, for `rows` rows, without a row's note ("New"). */
async function names(page: Page, rows: number): Promise<string[]> {
  const shown: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const text = await (await cellAt(page, row, 'Name')).innerText();
    shown.push(text.split('\n')[0]?.trim() ?? '');
  }
  return shown;
}

/** Sorts the table by a column from its menu. */
async function sortBy(page: Page, column: string, direction: 'Sort ascending' | 'Sort descending'): Promise<void> {
  const header = page.getByRole('columnheader', { name: new RegExp(column) });
  await header.click();
  await page.keyboard.press('Alt+ArrowDown');
  await page.getByRole('menuitem', { name: direction }).click();
}

/** Types a value into a row's cell and commits it, waiting for it to show. */
async function edit(page: Page, row: number, column: string, value: string): Promise<void> {
  const cell = await cellAt(page, row, column);
  await cell.click();
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
  await expect(cell).toContainText(value);
}

/** The job titles down the table, top to bottom, for `rows` rows. */
async function titles(page: Page, rows: number): Promise<string[]> {
  const shown: string[] = [];
  for (let row = 0; row < rows; row += 1) shown.push((await (await cellAt(page, row, 'Job title')).innerText()).trim());
  return shown;
}

test.describe('settling a sorted table', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flows run at desktop width.');
  test('moves others’ changes after the quiet spell, and keeps the person’s own rows where they are', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `settle-${tag}`;
    const people = `/w/${slug}/objects/people`;
    const email = `ada-${tag}@example.com`;
    const code = await newWorkspace(page, email, slug);
    for (const [first, last] of [
      ['Grace', 'Hopper'],
      ['Alan', 'Turing'],
      ['Edsger', 'Dijkstra'],
    ] as const) {
      await addPerson(page, first, last, `${first.toLowerCase()}-${tag}@example.com`);
    }
    // Newest first (AC-57), each made here noted New and first.
    await expect.poll(() => names(page, 3)).toEqual(['Edsger Dijkstra', 'Alan Turing', 'Grace Hopper']);
    await expect(page.getByText('New', { exact: true })).toHaveCount(3);

    await edit(page, 0, 'Job title', 'Cobol');
    await edit(page, 1, 'Job title', 'Basic');
    await edit(page, 2, 'Job title', 'Delphi');

    // The other browser, sorted by Job title: an unsaved sort for the visit.
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: testInfo.project.use.viewport ?? null,
    });
    const other = await context.newPage();
    await signInAgain(other, email, people, [code]);
    await sortBy(other, 'Job title', 'Sort ascending');
    await expect.poll(() => titles(other, 3)).toEqual(['Basic', 'Cobol', 'Delphi']);

    // This browser changes Basic to Zig: in the other one the value changes in place at once, and the row
    // moves to the end once the table has been quiet for 1.5 seconds.
    await edit(page, 1, 'Job title', 'Zig');
    const changedAt = Date.now();
    await expect.poll(() => titles(other, 1), { timeout: 2_000, intervals: [20] }).toEqual(['Zig']);
    await expect.poll(() => titles(other, 3), { timeout: 6_000, intervals: [50] }).toEqual(['Cobol', 'Delphi', 'Zig']);
    const movedAfter = Date.now() - changedAt;
    testInfo.annotations.push({ type: 'settled after (ms)', description: String(movedAfter) });
    expect(movedAfter).toBeGreaterThan(1_000);
    expect(await names(other, 3)).toEqual(['Edsger Dijkstra', 'Grace Hopper', 'Alan Turing']);

    // The other browser changes its own first row to sort last: it stays where they see it through the settle.
    await edit(other, 0, 'Job title', 'Zzz');
    await other.waitForTimeout(3_000);
    expect(await titles(other, 3)).toEqual(['Zzz', 'Delphi', 'Zig']);
    await checkScreen(other, 'settle-own-row-kept');

    // A record made in the sorted view sits first, noted New, until the person leaves the view.
    await addPerson(other, 'Ada', 'Lovelace', `ada-l-${tag}@example.com`);
    await expect.poll(() => names(other, 1)).toEqual(['Ada Lovelace']);
    await expect(other.getByText('New', { exact: true })).toHaveCount(1);
    await checkScreen(other, 'settle-made-here');
    await context.close();
  });
});
