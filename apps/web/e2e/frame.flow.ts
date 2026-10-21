// The workspace frame stays mounted while its pages change: the /w/$slug
// layout mounts it once and each page fills its bars. So the workspace menu,
// opened while the next page is still loading, stays open when that page
// arrives, keeps its focus (the page's title doesn't take it), and closes
// back to its trigger. The sidebar's own element is the same one throughout.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

/** How long each api call waits while the next page loads: long enough to open the menu over it. */
const SLOW_MS = 1500;

test.describe('workspace frame', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The sidebar shows its workspace menu at desktop width.');

  test('keeps the workspace menu open across a page change that finishes while it is open', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    await newWorkspace(page, `frame-${tag}@example.com`, `frame-${tag}`);
    await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();

    const trigger = page.getByRole('button', { name: /workspace menu/ });
    // Marked, so a remounted sidebar (a new element without the mark) would show.
    await trigger.evaluate((element) => {
      element.setAttribute('data-flow-mark', 'kept');
    });

    // Every api call now waits, so Companies is still loading when the menu opens.
    await page.route('**/api/rpc/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      await route.fallback();
    });
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Companies', exact: true })
      .click();
    await trigger.click();
    const signOut = page.getByRole('menuitem', { name: 'Sign out' });
    await expect(signOut).toBeVisible();

    // Companies arrives under the open menu, which stays open with its focus.
    await expect(page).toHaveURL(new RegExp(`/w/frame-${tag}/objects/companies`));
    await expect(page.getByRole('heading', { level: 1, name: 'Companies' })).toBeVisible({ timeout: 15_000 });
    await expect(signOut).toBeVisible();
    // Two frames on, past the focus move that runs a frame after the page renders.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    await expect(signOut).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.closest('[role="menu"]') !== null)).toBe(true);
    await expect(trigger).toHaveAttribute('data-flow-mark', 'kept');

    // Escape closes it back to its trigger, the same element as before.
    await page.keyboard.press('Escape');
    await expect(signOut).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.unroute('**/api/rpc/**');
  });
});
