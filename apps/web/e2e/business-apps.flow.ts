// First sight of the business apps (spec 0065, 6 November 2026, the owner: "those business apps should be active
// directly ... without going and manually active"): every app but Events is on in a brand new workspace with nothing
// to activate, each empty page reads well and offers the next step, nothing is public until someone publishes, the off
// switch holds across a reload, and a plain member sees none of it. FLOW_SCREENSHOTS=<dir> keeps each screen, and
// Settings › Apps at 1280 and 390 in light and dark. FLOW_OWNER_URL (a superuser on a local database) adds the member;
// without it the flow is skipped.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

const OWNER_URL = process.env.FLOW_OWNER_URL;
const SHOTS = process.env.FLOW_SCREENSHOTS;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: 'disabled' });
}

function psql(query: string): string {
  return execFileSync('psql', [OWNER_URL ?? '', '-Atc', query], { encoding: 'utf8' }).trim();
}

/** Nothing on the page speaks of installing or of access opened early, or breaks. */
async function readsWell(page: Page): Promise<void> {
  const text = (await page.locator('main').first().textContent()) ?? '';
  expect(text).not.toMatch(/install|early access|isn’t set up|couldn’t load|on its way to/i);
}

const FIRST_SCREENS = [
  ['menus', 'Put your menu online'],
  ['qr', 'A QR code for every table'],
  ['reservations', 'Take reservations online'],
  ['settings/services', 'List what clients can book'],
  ['settings/staff', 'Add the people clients book'],
  ['settings/shifts', 'Plan who works when'],
  ['settings/business', 'Set up your business'],
] as const;

test.describe('the business apps', () => {
  test.use({ locale: 'en-GB', timezoneId: 'Europe/London', actionTimeout: 15_000 });
  test.skip(OWNER_URL === undefined, 'Needs FLOW_OWNER_URL to add a plain member.');
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Walked at a desk; the phone’s shots are taken inside.');

  test('are on in a new workspace, read well empty, stay private, and switch off', async ({ page, browser }) => {
    test.setTimeout(420_000);
    const tag = String(Date.now()).slice(-7);
    const slug = `first-sight-${tag}`;
    await newWorkspace(page, `owner-${tag}@example.com`, slug);

    await test.step('the sidebar has the Business group, and nothing was made', async () => {
      await page.goto(`/w/${slug}/home`);
      const nav = page.getByRole('navigation', { name: 'Main navigation' });
      await expect(nav.getByRole('link', { name: 'Menus', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Tables', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Reservations', exact: true })).toBeVisible();
      await shot(page, 'home-sidebar');
      const made = psql(`
        select (select count(*) from workspace_apps a where a.workspace_id = w.id) || '/' ||
          (select count(*) from places p where p.workspace_id = w.id) || '/' ||
          (select count(*) from business_pages b where b.workspace_id = w.id) || '/' ||
          (select count(*) from workspace_roles r where r.workspace_id = w.id)
        from workspaces w where w.slug = '${slug}'`);
      expect(made).toBe('0/0/0/0');
    });

    await test.step('Settings › Apps, in both themes at both widths', async () => {
      await page.goto(`/w/${slug}/settings/apps`);
      await expect(page.getByRole('heading', { level: 1, name: 'Apps' })).toBeVisible();
      for (const app of ['Menu', 'Menu QR', 'Table seating', 'Appointments']) {
        await expect(page.getByRole('switch', { name: app, exact: true })).toBeChecked();
      }
      await expect(page.getByRole('switch', { name: 'Events', exact: true })).toHaveCount(0);
      await expect(page.getByText('On its way')).toBeVisible();
      await readsWell(page);
      for (const scheme of ['light', 'dark'] as const) {
        for (const width of [1280, 390]) {
          await page.emulateMedia({ colorScheme: scheme });
          await page.setViewportSize({ width, height: 900 });
          await shot(page, `apps-${scheme}-${String(width)}`);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        }
      }
      await page.emulateMedia({ colorScheme: 'light' });
      await page.setViewportSize({ width: 1280, height: 800 });
    });

    await test.step('⌘K reaches Apps and the business settings', async () => {
      await page.keyboard.press('ControlOrMeta+k');
      const menu = page.getByRole('dialog', { name: 'Command menu' });
      const box = menu.getByLabel('Search records, notes, tasks, pages and actions');
      await box.fill('Apps');
      await expect(menu.getByText('Settings › Apps').first()).toBeVisible();
      await box.fill('Places');
      await expect(menu.getByText('Settings › Places').first()).toBeVisible();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    });

    await test.step('every empty page says what it is and offers the card', async () => {
      for (const [path, heading] of FIRST_SCREENS) {
        await page.goto(`/w/${slug}/${path}`);
        await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'Set up your business' })).toBeVisible();
        await readsWell(page);
        await shot(page, `first-${path.replace('/', '-')}`);
      }
    });

    let keys = { menu: '', table: '' };
    await test.step('the card makes the business and opens the page, and nothing is public', async () => {
      await page.goto(`/w/${slug}/menus`);
      await page.getByRole('button', { name: 'Set up your business' }).click();
      const card = page.getByRole('dialog');
      await card.getByLabel('Business name').fill('Somewhere');
      await shot(page, 'card');
      await card.getByRole('button', { name: 'Set up', exact: true }).click();
      await expect(card).toBeHidden({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Set up your business' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'New menu' }).first()).toBeVisible();
      await shot(page, 'menus-empty');
      const [menu = '', table = ''] = psql(
        `select p.menu_key || ' ' || p.public_key from places p join workspaces w on w.id = p.workspace_id where w.slug = '${slug}'`,
      ).split(' ');
      keys = { menu, table };
      const pagesMade = psql(
        `select count(*) from business_pages b join workspaces w on w.id = b.workspace_id where w.slug = '${slug}'`,
      );
      expect(pagesMade).toBe('0');
      // Before a first Publish there is no guest menu, and no table taking reservations.
      const guest = await browser.newContext();
      const reader = await guest.newPage();
      const menuAnswer = await reader.request.get(`/api/public/menus/${keys.menu}`);
      expect(menuAnswer.ok()).toBe(false);
      await reader.goto(`/r/${keys.table}`);
      await expect(reader.getByRole('button', { name: /Reserve|Book/ })).toHaveCount(0);
      await shot(reader, 'guest-reserve-before-publish');
      await guest.close();
    });

    await test.step('each page after the card', async () => {
      for (const [path, name] of [
        ['qr', 'qr'],
        ['reservations', 'reservations'],
        ['settings/services', 'services'],
        ['settings/staff', 'staff'],
        ['settings/shifts', 'shifts'],
        ['settings/business', 'business'],
      ] as const) {
        await page.goto(`/w/${slug}/${path}`);
        await expect(page.getByRole('button', { name: 'Set up your business' })).toHaveCount(0);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await readsWell(page);
        await shot(page, `after-${name}`);
      }
    });

    await test.step('the off switch asks, holds across a reload, and comes back', async () => {
      await page.goto(`/w/${slug}/settings/apps`);
      await page.getByRole('switch', { name: 'Table seating', exact: true }).locator('xpath=ancestor::label').click();
      const ask = page.getByRole('alertdialog').or(page.getByRole('dialog'));
      await expect(ask.getByRole('heading', { name: 'Turn off Table seating?' })).toBeVisible();
      await shot(page, 'turn-off');
      await ask.getByRole('button', { name: 'Turn off', exact: true }).click();
      const nav = page.getByRole('navigation', { name: 'Main navigation' });
      await page.reload();
      await expect(page.getByRole('switch', { name: 'Table seating', exact: true })).not.toBeChecked();
      await page.goto(`/w/${slug}/reservations`);
      await expect(page.getByText('Table seating is off', { exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Reservations', exact: true })).toHaveCount(0);
      await shot(page, 'reservations-off');
      await page.getByRole('link', { name: 'Open Apps' }).click();
      await page.getByRole('switch', { name: 'Table seating', exact: true }).locator('xpath=ancestor::label').click();
      await expect(page.getByRole('switch', { name: 'Table seating', exact: true })).toBeChecked();
    });

    await test.step('a plain member sees nothing new', async () => {
      const second = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/London' });
      const other = await second.newPage();
      const otherSlug = `plain-${tag}`;
      await newWorkspace(other, `member-${tag}@example.com`, otherSlug);
      const memberId = '019a0000-0000-7000-8000-000000000001';
      psql(`
        with u as (select id from auth."user" where email = 'member-${tag}@example.com'),
             w as (select id from workspaces where slug = '${slug}'),
             m as (insert into members (id, workspace_id, name, email, user_id, role, status, created_by_type, updated_by_type)
               select '${memberId}', w.id, 'Bea', 'member-${tag}@example.com', u.id, 'member', 'active', 'system', 'system' from u, w returning 1)
        insert into auth.workspace_membership (user_id, workspace_id, member_id)
          select u.id, w.id, '${memberId}' from u, w where (select count(*) from m) = 1`);
      await other.goto(`/w/${slug}/home`);
      const nav = other.getByRole('navigation', { name: 'Main navigation' });
      await expect(nav.getByRole('link', { name: 'People', exact: true })).toBeVisible();
      for (const name of ['Menus', 'Tables', 'Reservations']) {
        await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
      }
      await shot(other, 'member-home');
      for (const path of ['menus', 'qr', 'reservations']) {
        await other.goto(`/w/${slug}/${path}`);
        await expect(other.getByText('This page isn’t here')).toBeVisible();
      }
      await shot(other, 'member-menus');
      await other.goto(`/w/${slug}/settings/apps`);
      await expect(other.getByRole('heading', { name: 'Menu QR' })).toBeVisible();
      await expect(other.getByRole('switch')).toHaveCount(0);
      await expect(other.getByRole('button', { name: /install/i })).toHaveCount(0);
      await shot(other, 'member-apps');
      await other.goto(`/w/${slug}/settings/members`);
      await expect(other.getByRole('link', { name: 'Apps', exact: true })).toHaveCount(0);
      await expect(other.getByRole('link', { name: 'Business', exact: true })).toHaveCount(0);
      await second.close();
    });
  });
});
