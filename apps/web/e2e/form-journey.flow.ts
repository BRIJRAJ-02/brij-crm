// The form journey end to end (flow walks, 29 October 2026): Captures › Forms › New form; a question added and
// mapped onto People's Job title; the first publish, in one step; a visitor sends it; the answer lands on the
// person's Job title in People; and changing which object the form saves to asks first, Cancel keeping People.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

/** The hosted form's bot check wants a human's pace before Send. */
const HUMAN_PACE_MS = 3_000;

test.describe('the form journey', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The editor runs at desktop width.');

  test('make a form, map a question, publish, send it as a visitor, and find the answer on the person', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `formjourney-${tag}`;
    await newWorkspace(page, `formjourney-${tag}@example.com`, slug);

    await page.goto(`/w/${slug}/captures/forms`);
    await page.getByRole('button', { name: 'New form' }).first().click();
    await expect(page).toHaveURL(/\/captures\/forms\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const formUrl = page.url().replace(/\?.*$/, '');

    // A question mapped onto an attribute People already has.
    await page.getByRole('button', { name: 'Add a question' }).click();
    await page.getByLabel('Question', { exact: true }).last().fill('What is your role?');
    await page
      .getByRole('button', { name: /Where it goes$/ })
      .last()
      .click();
    await page.getByRole('option', { name: 'Job title', exact: true }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(page.getByText('Person › Job title').first()).toBeVisible();

    // The first publish, in one step: name it, check where the answers go, publish.
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const publish = page.getByRole('dialog', { name: 'Publish your form' });
    await publish.getByLabel('Name').fill(`Talk to us ${tag}`);
    await expect(publish.getByRole('button', { name: /Save to$/ })).toContainText('People');
    await publish.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your form is live' })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByText(/Live · v1/).first()).toBeVisible();
    // Its public address, from Settings › Details › Link.
    await page.goto(`${formUrl}?tab=settings`);
    const key = await page.getByRole('textbox', { name: /^Link/ }).inputValue();

    // The visitor, signed in to nothing, sends it.
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await visitor.goto(`${new URL(page.url()).origin}/f/${key}`);
    await visitor.getByLabel(/Your name/).fill('Grace Hopper');
    await visitor.getByLabel(/Work email/).fill(`grace-${tag}@example.com`);
    await visitor.getByLabel(/What is your role\?/).fill('Rear admiral');
    await visitor.waitForTimeout(HUMAN_PACE_MS);
    await visitor.getByRole('button', { name: 'Send' }).click();
    await expect(visitor.getByText(/Thank you/).first()).toBeVisible({ timeout: 15_000 });
    await visitorContext.close();

    // The owner: the person is in People with the answer on Job title.
    await page.goto(`/w/${slug}/objects/people`);
    const row = page.getByRole('grid', { name: 'People' }).getByRole('row').filter({ hasText: 'Grace Hopper' });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect(row).toContainText('Rear admiral');

    // Changing which object the form saves to would unfile the question: asked first; Cancel keeps People.
    await page.goto(`${formUrl}?tab=settings`);
    await page.getByRole('button', { name: /Save to$/ }).click();
    await page.getByRole('option', { name: 'Companies', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Change which object submissions are saved to?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('button', { name: /Save to$/ })).toContainText('People');
  });
});
