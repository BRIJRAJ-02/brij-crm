// Saved views, milestone 2 (spec 0020), end to end with two members in two
// browsers: Ada (the owner) makes a private view and a shared one from the
// switcher; Bea (a member) sees the shared one and never the private one;
// a column hidden in View settings reaches Bea; a locked view keeps Bea's
// column change in her tab only and offers her only Save as new view; Save
// as new view from Ada's Save menu opens a view of its own; the object's
// address reopens the view last opened; and a deleted view leaves Bea's tab
// on the default view (AC-470, AC-472 to AC-478, AC-489). Then a schema change
// (a column or a relationship made from the "+" header, here or in another
// tab) reloads the table without remounting it: its scroll and focus stay, and
// the writer's own change reads the attributes once.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, checkScreen, chooseNewAttribute, newWorkspace, objectUrl, signInAgain } from './people.ts';

/**
 * Whether live updates reach the browsers: Centrifugo admits only the app on :5173, so a run on another port
 * (`FLOW_LIVE=off`) reloads the second browser where it would otherwise watch the change arrive.
 */
const LIVE = process.env.FLOW_LIVE !== 'off';
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Adds `email` to the workspace as a member (local only: `member:add`, as versions.flow.ts does). */
function addMember(slug: string, email: string, name: string): void {
  execFileSync(
    'pnpm',
    ['--filter', '@crm/core', 'member:add', '--workspace', slug, '--email', email, '--role', 'member', '--name', name],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

const grid = (page: Page) => page.getByRole('grid', { name: 'People' });
const viewBarSwitcher = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).first();

/** Opens the switcher on the current view (named `current`) and answers its menu. */
async function openSwitcher(page: Page, current: string) {
  await viewBarSwitcher(page, current).click();
  const menu = page.getByRole('menu', { name: current });
  await expect(menu).toBeVisible();
  return menu;
}

/** Who can see it, in an open switcher (30 October 2026: one choice in place of Share, Make private and Lock). */
async function chooseWho(page: Page, choice: 'Only me' | 'Everyone' | 'Everyone, only admins edit'): Promise<void> {
  await page.getByRole('menuitem', { name: 'Who can see it' }).click();
  await page.getByRole('menuitem', { name: choice, exact: true }).click();
}

/**
 * Creates a view from the switcher's Create view, named `name`: it is private, and starts from the view open; for
 * everyone it is shared afterwards from its own menu (30 October 2026: the dialog asks only Name and Type).
 */
async function createView(page: Page, current: string, name: string, everyone: boolean): Promise<void> {
  const menu = await openSwitcher(page, current);
  await menu.getByRole('menuitemradio', { name: 'Create view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create view' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create view' }).click();
  await expect(dialog).toBeHidden();
  await expect(viewBarSwitcher(page, name)).toBeVisible();
  if (!everyone) return;
  await openSwitcher(page, name);
  await chooseWho(page, 'Everyone');
  await expect(page.getByText(`${name} is shared with everyone.`)).toBeVisible();
}

/** Flips one column's switch in View settings, then closes it. */
async function toggleColumn(page: Page, column: string): Promise<void> {
  await page.getByRole('button', { name: 'View settings' }).click();
  const settings = page.getByRole('dialog', { name: 'View settings' });
  await settings.getByRole('switch', { name: `Show ${column}` }).press('Space');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
}

const header = (page: Page, column: string) => grid(page).getByRole('columnheader', { name: column });

test.describe('saved views: many views and their layout', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('private and shared views, a layout that travels, a lock, Save as new view, the last view and a delete', async ({
    browser,
    page: ada,
  }, testInfo) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const adaEmail = `ada-views-${tag}@example.com`;
    const beaEmail = `bea-views-${tag}@example.com`;
    const slug = `views-m2-${tag}`;
    await newWorkspace(ada, adaEmail, slug);
    await expect(ada).toHaveURL(objectUrl(slug, 'people'));
    const defaultUrl = new URL(ada.url()).pathname;
    await addPerson(ada, 'Grace', 'Hopper', `grace-${tag}@acme.com`);
    await expect(grid(ada).getByText('Grace Hopper', { exact: true })).toBeVisible();

    // Ada makes a private view and a shared one; the switcher groups them (AC-472, AC-473).
    await createView(ada, 'All People', 'My people', false);
    // A view starting from this one shows the same records.
    await expect(grid(ada).getByText('Grace Hopper', { exact: true })).toBeVisible();
    await createView(ada, 'My people', 'Pipeline', true);
    await expect(grid(ada).getByText('Grace Hopper', { exact: true })).toBeVisible();
    const pipelineUrl = new URL(ada.url()).pathname;
    const menu = await openSwitcher(ada, 'Pipeline');
    await expect(menu.getByRole('group', { name: 'Private' }).getByText('My people')).toBeVisible();
    await checkScreen(ada, 'views-switcher');
    await ada.keyboard.press('Escape');

    // Bea, a member, sees the shared view and never Ada's private one (AC-477).
    addMember(slug, beaEmail, 'Bea Ruiz');
    const beaContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: testInfo.project.use.viewport ?? null,
    });
    const bea = await beaContext.newPage();
    await signInAgain(bea, beaEmail, pipelineUrl, []);
    await expect(viewBarSwitcher(bea, 'Pipeline')).toBeVisible();
    const beaMenu = await openSwitcher(bea, 'Pipeline');
    await expect(beaMenu.getByRole('menuitemradio', { name: 'All People' })).toBeVisible();
    await expect(beaMenu.getByText('My people')).toHaveCount(0);
    await bea.keyboard.press('Escape');

    // Ada hides Job title on Pipeline: it saves for everyone on the view (AC-470).
    await expect(header(ada, 'Job title')).toBeVisible();
    await toggleColumn(ada, 'Job title');
    await expect(header(ada, 'Job title')).toBeHidden();
    if (!LIVE) await bea.reload();
    await expect(header(bea, 'Job title')).toBeHidden({ timeout: 10_000 });

    // Make private asks first, naming the view; Cancel keeps it shared.
    await openSwitcher(ada, 'Pipeline');
    await chooseWho(ada, 'Only me');
    const goPrivate = ada.getByRole('dialog', { name: 'Make Pipeline private?' });
    await expect(goPrivate).toBeVisible();
    await goPrivate.getByRole('button', { name: 'Cancel' }).click();
    await expect(goPrivate).toBeHidden();

    // Ada locks Pipeline; Bea's column change stays in her tab, and she may only save a draft as a view of her own
    // (AC-475, AC-476).
    // The view's own actions sit under "This view" in the switcher's menu (21 October 2026).
    await openSwitcher(ada, 'Pipeline');
    await chooseWho(ada, 'Everyone, only admins edit');
    await expect(ada.getByText('Locked by Ada Lovelace.')).toBeVisible();
    if (!LIVE) await bea.reload();
    await expect(bea.getByText('Locked by Ada Lovelace. Your changes here aren’t saved.')).toBeVisible({
      timeout: 10_000,
    });
    await toggleColumn(bea, 'Job title');
    await expect(header(bea, 'Job title')).toBeVisible();
    await bea.reload();
    await expect(header(bea, 'Job title')).toBeHidden();
    await openSwitcher(bea, 'Pipeline');
    await expect(bea.getByRole('menuitem', { name: /Rename/ })).toBeDisabled();
    await expect(bea.getByRole('menuitem', { name: /Rename/ })).toContainText('This view is locked.');
    await expect(bea.getByRole('menuitem', { name: 'Who can see it' })).toHaveCount(0);
    await bea.keyboard.press('Escape');
    await checkScreen(bea, 'views-locked');

    // Ada drafts a sort and keeps it as a view of its own from the Save menu (AC-466, AC-472).
    // The default order shows as a muted "Sorted by Created at" chip that opens the builder; Created at starts ascending.
    await ada
      .getByRole('toolbar', { name: 'View options' })
      .getByRole('button', { name: 'Sorted by Created at' })
      .click();
    const sorts = ada.getByRole('dialog', { name: 'Sorts' });
    await sorts.getByRole('button', { name: 'Add sort' }).click();
    await ada.getByRole('menuitem', { name: 'Created at' }).click();
    await expect(sorts.getByRole('button', { name: /Ascending/ })).toBeVisible();
    // The direction menu has closed (its exit takes a moment) before Esc closes the builder.
    await expect(ada.getByRole('menu')).toHaveCount(0);
    await ada.keyboard.press('Escape');
    await expect(sorts).toBeHidden();
    await expect(ada).toHaveURL(/\?draft=/);
    await ada.getByRole('toolbar', { name: 'View options' }).getByRole('button', { name: 'Save as new view' }).click();
    const saveAs = ada.getByRole('dialog', { name: 'Save as new view' });
    await saveAs.getByLabel('Name').fill('Oldest first');
    await saveAs.getByRole('button', { name: 'Save as new view' }).click();
    await expect(viewBarSwitcher(ada, 'Oldest first')).toBeVisible();
    await expect(ada).not.toHaveURL(/draft=/);
    const oldestUrl = new URL(ada.url()).pathname;

    // The object's address reopens the view last opened (AC-478).
    await ada.goto(`/w/${slug}/objects/people`);
    await expect(ada).toHaveURL(new RegExp(`${oldestUrl}$`));

    // Ada deletes Pipeline: Bea's tab goes to the default view (AC-474), or, reloaded, finds it gone (AC-463).
    await ada.goto(pipelineUrl);
    // It asks first: Cancel changes nothing, and the view stays.
    await openSwitcher(ada, 'Pipeline');
    await ada.getByRole('menuitem', { name: 'Delete view' }).click();
    const confirm = ada.getByRole('alertdialog', { name: 'Delete Pipeline for everyone?' });
    await expect(confirm).toContainText('Everyone who sees this view loses it for good, and its records stay.');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await expect(viewBarSwitcher(ada, 'Pipeline')).toBeVisible();
    await expect(ada).toHaveURL(new RegExp(`${pipelineUrl}$`));
    await openSwitcher(ada, 'Pipeline');
    await ada.getByRole('menuitem', { name: 'Delete view' }).click();
    await confirm.getByRole('button', { name: 'Delete view' }).click();
    await expect(ada).toHaveURL(new RegExp(`${defaultUrl}$`));
    await expect(ada.getByText('Deleted Pipeline.')).toBeVisible();
    // This tab's own delete raises no "isn't available" notice.
    await expect(ada.getByText('Pipeline isn’t available to you any more', { exact: false })).toHaveCount(0);
    if (LIVE) {
      await expect(bea).toHaveURL(new RegExp(`${defaultUrl}$`), { timeout: 10_000 });
      await expect(bea.getByText('Pipeline isn’t available to you any more, so you’re on All People.')).toBeVisible();
    } else {
      await bea.reload();
      await expect(bea.getByText('This view doesn’t exist or isn’t shared with you.')).toBeVisible();
    }
    await beaContext.close();
  });
});

test.describe('a schema change keeps the table where it was', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('a column made from the "+" header stays in sight and focused as the table reloads', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `views-scroll-${tag}`;
    await newWorkspace(page, `scroll-${tag}@example.com`, slug);
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@acme.com`);
    const table = grid(page);
    await expect(table.getByText('Grace Hopper', { exact: true })).toBeVisible();
    // Scrolled to the far right, where the "+" header sits; the grid's element is marked to tell a remount.
    await table.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.setAttribute('data-probe', 'kept');
    });
    const plus = table.getByRole('columnheader').getByRole('button', { name: 'Add attribute' });
    let attributeReads = 0;
    page.on('request', (request) => {
      if (request.url().includes('/rpc/attributes/list')) attributeReads += 1;
    });
    await plus.click();
    await chooseNewAttribute(page);
    const dialog = page.getByRole('dialog', { name: 'New attribute' });
    await dialog.getByLabel('Name', { exact: true }).fill('Nickname');
    await dialog.getByRole('button', { name: 'Create attribute' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[role="columnheader"]:focus')).toContainText('Nickname');
    // Past every reload the write brings (its own, and its echo when live): still scrolled, still focused, in sight.
    await page.waitForTimeout(3000);
    await expect(page.locator('[role="columnheader"]:focus')).toContainText('Nickname');
    await expect(table.getByRole('columnheader', { name: /Nickname/ })).toBeInViewport();
    expect(await table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(table).toHaveAttribute('data-probe', 'kept');
    // One reload for the write: its echo (live) is skipped as this tab's own.
    expect(attributeReads).toBe(1);
  });

  test('a column made in another tab reloads this one without moving its scroll or focus', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `views-scroll2-${tag}`;
    const email = `scroll2-${tag}@example.com`;
    const code = await newWorkspace(page, email, slug);
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@acme.com`);
    const table = grid(page);
    await expect(table.getByText('Grace Hopper', { exact: true })).toBeVisible();
    const other = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: testInfo.project.use.viewport ?? null,
    });
    const second = await other.newPage();
    await signInAgain(second, email, new URL(page.url()).pathname, [code]);
    await expect(grid(second).getByText('Grace Hopper', { exact: true })).toBeVisible();
    await table.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.setAttribute('data-probe', 'kept');
    });
    const before = await table.evaluate((element) => element.scrollLeft);
    await table.getByRole('columnheader', { name: /Created at/ }).focus();
    await grid(second).getByRole('columnheader').getByRole('button', { name: 'Add attribute' }).click();
    await chooseNewAttribute(second);
    const dialog = second.getByRole('dialog', { name: 'New attribute' });
    await dialog.getByLabel('Name', { exact: true }).fill('Nickname');
    await dialog.getByRole('button', { name: 'Create attribute' }).click();
    await expect(dialog).toBeHidden();
    if (LIVE) await expect(table.getByRole('columnheader', { name: /Nickname/ })).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(3000);
    expect(await table.evaluate((element) => element.scrollLeft)).toBeGreaterThanOrEqual(before - 1);
    await expect(table).toHaveAttribute('data-probe', 'kept');
    await expect(page.locator('[role="columnheader"]:focus')).toContainText('Created at');
    await other.close();
  });

  test('a relationship made from the "+" header reloads the table once and keeps its new column in sight', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `views-scroll3-${tag}`;
    await newWorkspace(page, `scroll3-${tag}@example.com`, slug);
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@acme.com`);
    const table = grid(page);
    await expect(table.getByText('Grace Hopper', { exact: true })).toBeVisible();
    await table.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.setAttribute('data-probe', 'kept');
    });
    let attributeReads = 0;
    page.on('request', (request) => {
      if (request.url().includes('/rpc/attributes/list')) attributeReads += 1;
    });
    await table.getByRole('columnheader').getByRole('button', { name: 'Add attribute' }).click();
    await chooseNewAttribute(page);
    const attribute = page.getByRole('dialog', { name: 'New attribute' });
    await attribute.getByLabel('Name', { exact: true }).fill('Employers');
    await attribute.getByRole('button', { name: /Type$/ }).click();
    await page.getByRole('option', { name: 'Relationship', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New relationship' });
    await dialog
      .getByRole('button', { name: /Related object/ })
      .and(dialog.locator('[aria-haspopup="listbox"]'))
      .click();
    await page.getByRole('option', { name: 'Companies', exact: true }).click();
    await dialog.getByRole('button', { name: 'Create relationship' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[role="columnheader"]:focus')).toContainText('Employers');
    await page.waitForTimeout(3000);
    await expect(page.locator('[role="columnheader"]:focus')).toContainText('Employers');
    await expect(table.getByRole('columnheader', { name: /Employers/ })).toBeInViewport();
    await expect(table).toHaveAttribute('data-probe', 'kept');
    // Its own write reads People's attributes once; its echo (live) is skipped as this tab's own.
    expect(attributeReads).toBe(1);
  });
});
