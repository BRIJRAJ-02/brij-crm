// The link page journey end to end (flow walks, 29 October 2026): a new workspace's link page is live from the
// start; Edit page adds a link (refused until it has a title) and an email signup, and Done shows them in the
// preview; a visitor on a phone opens the page, finds both, and signs up; the owner finds the signup under
// Captures › Forms with its one submission.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

/** The hosted form's bot check wants a human's pace before Send. */
const HUMAN_PACE_MS = 3_000;

test.describe('the link page journey', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 1000,
    'The editor runs at desktop width; the visitor at a phone’s.',
  );

  test('add a link and a signup, then sign up as a visitor and find it in Captures', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `linkjourney-${tag}`;
    await newWorkspace(page, `linkjourney-${tag}@example.com`, slug);

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Link page', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Link page' })).toBeVisible();
    // Live before anything is added: the address is the person's handle, on the app's own host locally.
    await expect(page.getByText('Live').first()).toBeVisible();
    // Share online's Open is the public page; the visitor goes there.
    const publicPage = await page
      .getByRole('group', { name: 'Share online' })
      .getByRole('link', { name: 'Open' })
      .getAttribute('href');
    expect(publicPage).toMatch(/\/[a-z0-9-]+$/);

    await page.getByRole('button', { name: 'Edit page' }).click();
    await expect(page).toHaveURL(/edit=true/);

    // A link: the address alone is refused, named on its Title.
    await page.getByRole('button', { name: 'Add item' }).click();
    const add = page.getByRole('dialog', { name: 'Add to your link page' });
    await add.getByLabel('Address').fill('example.com/portfolio');
    await add.getByRole('button', { name: /^Add item/ }).click();
    await expect(add.getByText('Give the link a title.')).toBeVisible();
    await add.getByLabel('Title').fill('Portfolio');
    await add.getByRole('button', { name: /^Add item/ }).click();
    await expect(add).toBeHidden();

    // An email signup, with its own defaults.
    await page.getByRole('button', { name: 'Add item' }).click();
    await add.getByRole('radio', { name: /Email signup/ }).check({ force: true });
    await add.getByRole('button', { name: /^Add item/ }).click();
    await expect(add).toBeHidden();

    const preview = page.getByRole('region', { name: 'Preview' }).or(page.locator('main'));
    await expect(preview.getByText('Portfolio').first()).toBeVisible();
    await expect(preview.getByText('Join the list').first()).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // The visitor, on a phone, signed in to nothing.
    const visitorContext = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true });
    const visitor = await visitorContext.newPage();
    await visitor.goto(publicPage ?? '');
    await expect(visitor.getByRole('link', { name: /Portfolio/ })).toHaveAttribute('href', /example\.com\/portfolio/);
    await visitor.getByText('Join the list').click();
    await expect(visitor).toHaveURL(/\/f\//);
    await visitor.getByLabel('Email').fill(`subscriber-${tag}@example.com`);
    await visitor.waitForTimeout(HUMAN_PACE_MS);
    await visitor.getByRole('button', { name: 'Sign me up' }).click();
    await expect(visitor.getByText(/^Thank you/).first()).toBeVisible({ timeout: 15_000 });

    // The owner: the signup is a form under Captures, holding the one submission.
    await page.goto(`/w/${slug}/captures/forms`);
    await page.getByText('Join the list').first().click();
    await page.getByRole('tab', { name: 'Submissions' }).click();
    await expect(page.getByText(`subscriber-${tag}@example.com`).first()).toBeVisible({ timeout: 30_000 });
    await visitorContext.close();
  });
});
