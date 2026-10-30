// The settings pages that say less (copy pass, 31 October 2026), each read in the real app: the Background jobs
// table is empty under its title alone, and its confirms are the 400px question; Workspace security heads its rows
// without a line under them and asks its sign out in the one short sentence; Scheduling access has no sentence
// under an empty list; Sign in and devices lost its section lines; and Calendars offers a provider button, not a
// paragraph of why (or says plainly that sync is off).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

/** A new workspace of its own, its slug back. */
async function fresh(page: Page, name: string): Promise<string> {
  const tag = randomUUID().slice(0, 8);
  const slug = `${name}-${tag}`;
  await newWorkspace(page, `${name}-${tag}@example.com`, slug);
  return slug;
}

test.describe('the settings pages that say less', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Settings and the sidebar run at desktop width.');

  test('Background jobs and Workspace security say it in a few words', async ({ page }) => {
    test.setTimeout(180_000);
    const slug = await fresh(page, 'wordsa');

    // No jobs yet: the title alone, with no sentence about what shows here.
    await page.goto(`/w/${slug}/settings/jobs`);
    await expect(page.getByText('No background jobs yet')).toBeVisible();
    await expect(page.getByText(/Long work in this workspace/)).toHaveCount(0);

    // Workspace security: headings and switches only, so no line under Session length, and Sign out everyone's one
    // consequence in its 400px confirm.
    await page.goto(`/w/${slug}/settings/security`);
    await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();
    await expect(page.getByText('Session length', { exact: true })).toBeVisible();
    await expect(page.getByText(/How long people stay signed in/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out everyone' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Sign out everyone?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(/signs in again\. Unsaved work is lost\./)).toBeVisible();
    await expect(confirm.getByText(/on every device/)).toHaveCount(0);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
  });

  test('Scheduling access, Sign in and devices and Calendars drop the lines that repeat their labels', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const slug = await fresh(page, 'wordsb');

    // Alone in the workspace: nobody else yet, and nobody to add, each in a few words.
    await page.goto(`/w/${slug}/settings/account/scheduling`);
    await expect(page.getByRole('heading', { level: 1, name: 'Scheduling access' })).toBeVisible();
    await expect(page.getByText('Nobody else yet.')).toBeVisible();
    await expect(page.getByText(/Add an assistant or a colleague/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Add someone' }).click();
    await expect(page.getByText('Everyone already has access.')).toBeVisible();
    await page.keyboard.press('Escape');

    // Sign in and devices: sections headed by their names, with no sentence restating them.
    await page.goto(`/w/${slug}/settings/account/sign-in`);
    await expect(page.getByRole('heading', { name: 'Signed in devices' })).toBeVisible();
    await expect(page.getByText(/Each browser and app signed in to your account/)).toHaveCount(0);
    await expect(page.getByText('Last 90 days.')).toBeVisible();

    // Calendars: a provider button where sync is on, or the plain note where it is off. Never a paragraph of why.
    await page.goto(`/w/${slug}/settings/account/calendars`);
    await expect(page.getByRole('heading', { level: 1, name: 'Calendars' })).toBeVisible();
    await expect(page.getByText(/Connect your calendar so bookings avoid your busy times/)).toHaveCount(0);
    const off = page.getByText('Calendar sync is off');
    const none = page.getByText('No calendar connected');
    await expect(off.or(none)).toBeVisible();
    if (await none.isVisible()) {
      await expect(page.getByRole('button', { name: /^Connect (Google|Outlook) calendar$/ }).first()).toBeVisible();
    } else {
      await expect(page.getByText('Booking pages still use your hours.')).toBeVisible();
    }
  });
});
