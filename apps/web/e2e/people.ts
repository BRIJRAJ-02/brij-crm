// Helpers for the flows on an object's table (spec 0005): sign a new person
// in through Mailpit and make their workspace, find a cell in the virtualised
// grid, add a person, and check a screen with axe in light and dark (with a
// picture of each when FLOW_SCREENSHOTS names a folder).
import { createRequire } from 'node:module';
import path from 'node:path';
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
export async function checkScreen(page: Page, name: string): Promise<void> {
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

/** Signs a new person in through Mailpit and makes their workspace, landing on its People page; answers the code used. */
export async function newWorkspace(page: Page, email: string, slug: string): Promise<string> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/verify/);
  const code = await codeFor(page.request, email);
  await page.getByLabel('Code').fill(code);
  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByLabel('Your name').fill('Ada Lovelace');
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people$`));
  return code;
}

/** Signs `email` in again on another page (another browser), opening `path`; `seen` are codes already used. */
export async function signInAgain(page: Page, email: string, path: string, seen: readonly string[]): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/verify/);
  await page.getByLabel('Code').fill(await codeFor(page.request, email, seen));
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

/**
 * Scrolls the grid sideways until a column's header is drawn (columns past
 * the first dozen are virtualised), and answers its place in the row.
 */
export async function showColumn(page: Page, column: string): Promise<number> {
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
export async function cellAt(page: Page, row: number, column: string) {
  const col = await showColumn(page, column);
  return page.getByRole('grid', { name: 'People' }).locator(`[data-cell="${String(row)}:${String(col)}"]`);
}

/** Adds a person through "New person": first and last name, and an email; waits for the row and its focus. */
export async function addPerson(page: Page, first: string, last: string, email: string): Promise<void> {
  await page.getByRole('button', { name: 'New person' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New person' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('First name').fill(first);
  await dialog.getByLabel('Last name').fill(last);
  await dialog.getByLabel('Email addresses').fill(email);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
}
