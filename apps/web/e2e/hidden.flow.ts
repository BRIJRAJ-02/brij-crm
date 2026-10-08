// Hidden means absent on the People table (spec 0009, milestone 2, step 11):
// the api's local rules server (`apps/api/test/rules-server.ts`) injects, for
// the member role, a hidden Job title, a read only Description and an `own`
// record rule on Owner. Signed in as that member, the table has no Job title
// column, no rows owned by anyone else and no Add attribute, and Description
// is read only with the rule's reason; the owner sees everything. Runs only
// when RULES_SLUG, RULES_MEMBER and RULES_OWNER name a workspace seeded with
// Ada and Cy owned by the member and Bob and Dee by the owner. Verifies
// AC-140 to AC-143 in the browser.
import { expect, test, type Page } from '@playwright/test';
import { codeFor } from './mailpit.ts';

const SLUG = process.env.RULES_SLUG;
const MEMBER = process.env.RULES_MEMBER;
const OWNER = process.env.RULES_OWNER;

/** Signs `email` in through Mailpit, then opens the workspace's People page. */
async function peopleAs(page: Page, email: string, slug: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/verify/);
  await page.getByLabel('Code').fill(await codeFor(page.request, email));
  await expect(page).not.toHaveURL(/\/verify/);
  await page.goto(`/w/${slug}/objects/people`);
  await expect(page.getByRole('grid', { name: 'People' })).toBeVisible();
}

/** Every column header's name, scrolling the grid sideways (columns past the first dozen are virtualised). */
async function columnNames(page: Page): Promise<readonly string[]> {
  const grid = page.getByRole('grid', { name: 'People' });
  const names = new Set<string>();
  await grid.evaluate((element) => {
    element.scrollLeft = 0;
  });
  for (let step = 0; step < 40; step += 1) {
    for (const name of await grid.getByRole('columnheader').allInnerTexts()) names.add(name.trim());
    const end = await grid.evaluate((element) => element.scrollLeft + element.clientWidth >= element.scrollWidth - 1);
    if (end) break;
    await grid.evaluate((element) => {
      element.scrollLeft += 300;
    });
    await page.waitForTimeout(50);
  }
  return [...names];
}

/** Scrolls the grid sideways from the start until a column's header is drawn, and answers its place in the row. */
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

test.describe('hidden means absent', () => {
  test.skip(
    SLUG === undefined || MEMBER === undefined || OWNER === undefined,
    'Runs against the rules test server, with RULES_SLUG, RULES_MEMBER and RULES_OWNER set.',
  );
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('a member sees no hidden column and no row outside their rule; the owner sees everything', async ({
    browser,
  }) => {
    const slug = SLUG ?? '';
    const member = await browser.newPage();
    await peopleAs(member, MEMBER ?? '', slug);
    const grid = member.getByRole('grid', { name: 'People' });
    await expect(grid.getByText('Ada Lovelace', { exact: true })).toBeVisible();
    await expect(grid.getByText('Cy Cole', { exact: true })).toBeVisible();
    await expect(grid.getByText('Bob Byte', { exact: true })).toHaveCount(0);
    await expect(grid.getByText('Dee Dunn', { exact: true })).toHaveCount(0);
    const columns = await columnNames(member);
    expect(columns.some((name) => name.includes('Job title'))).toBe(false);
    expect(columns.some((name) => name.includes('Description'))).toBe(true);
    await expect(member.getByRole('button', { name: 'Add attribute' })).toHaveCount(0);
    // Description is read only in the library's read only state, with the rule's reason.
    const column = await showColumn(member, 'Description');
    const cell = grid.locator(`[data-cell="0:${String(column)}"]`);
    await expect(cell).toHaveAttribute('aria-readonly', 'true');
    await expect(cell).toHaveAccessibleDescription("Your role can't change Description.");
    await member.screenshot({ path: test.info().outputPath('member-people.png') });
    await member.close();

    const owner = await browser.newPage();
    await peopleAs(owner, OWNER ?? '', slug);
    const all = owner.getByRole('grid', { name: 'People' });
    for (const name of ['Ada Lovelace', 'Bob Byte', 'Cy Cole', 'Dee Dunn'])
      await expect(all.getByText(name, { exact: true })).toBeVisible();
    expect((await columnNames(owner)).some((name) => name.includes('Job title'))).toBe(true);
    await owner.screenshot({ path: test.info().outputPath('owner-people.png') });
    await owner.close();
  });
});
