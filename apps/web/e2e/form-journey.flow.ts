// The form journey end to end (flow walks, 29 October 2026): Captures › Forms › New form; a question added and
// mapped onto People's Job title; the first publish, one click with nothing asked (5 November 2026); a visitor
// sends it; the answer lands on the person's Job title in People; changing which object the form saves to asks
// first, Cancel keeping People; and Discard changes puts an edit back to what is live, after a confirm.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';
import { newForm } from './forms.ts';

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
    await newForm(page);
    const formUrl = page.url().replace(/\?.*$/, '');

    // A question mapped onto an attribute People already has.
    await page.getByRole('button', { name: 'Add a question' }).click();
    await page.getByLabel('Question', { exact: true }).last().fill('What is your role?');
    await page
      .getByRole('button', { name: /Save answer to$/ })
      .last()
      .click();
    await page.getByRole('option', { name: 'Job title', exact: true }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    // Where the answer is saved shows in the question's editor, not on its row (T17).
    await expect(page.getByRole('button', { name: /Save answer to$/ }).last()).toContainText('Job title');

    // Named on the page, as a title (Tally's way); then the first publish is one click, with nothing asked.
    const title = page.getByRole('textbox', { name: 'Name', exact: true });
    await title.fill(`Talk to us ${tag}`);
    await title.press('Tab');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Talk to us ${tag}`, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your form is live' })).toBeVisible({ timeout: 30_000 });
    expect(await page.getByRole('dialog', { name: 'Publish your form' }).count()).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.getByText('Live', { exact: true }).first()).toBeVisible();
    // Nothing left to publish: the one primary goes until there is.
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
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
    await expect(visitor.getByText(/Thanks, we got it/).first()).toBeVisible({ timeout: 15_000 });
    await visitorContext.close();

    // The owner: the person is in People with the answer on Job title.
    await page.goto(`/w/${slug}/objects/people`);
    const row = page.getByRole('grid', { name: 'People' }).getByRole('row').filter({ hasText: 'Grace Hopper' });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect(row).toContainText('Rear admiral');

    // Changing which object the form saves to moves the saved questions: asked first, naming them; Cancel keeps People.
    await page.goto(`${formUrl}?tab=settings`);
    await page
      .getByRole('button', { name: /Save answers to$/ })
      .last()
      .click();
    await page.getByRole('option', { name: 'Companies', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Save answers to Companies?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('button', { name: /Save answers to$/ }).last()).toContainText('People');

    // A change saves to the draft by itself; Discard changes (⋯, asks first) puts it back to what is live. The
    // button's words are edited on the preview (T21), pressing the button.
    await page.goto(formUrl);
    if ((await page.getByRole('button', { name: 'Edit the button' }).count()) === 0) {
      await page.getByRole('button', { name: 'Show preview' }).click();
    }
    await page.getByRole('button', { name: 'Edit the button' }).click();
    const button = page.getByRole('textbox', { name: 'Button text' });
    await button.fill('Send it');
    await page.keyboard.press('Escape');
    // The preview's sheet (below the widest screens) closes too, so the header is in reach.
    if (await page.getByRole('dialog').isVisible()) await page.keyboard.press('Escape');
    await expect(page.getByText('Live · edited').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Discard changes' }).click();
    const discard = page.getByRole('alertdialog', { name: 'Discard your changes?' });
    await discard.getByRole('button', { name: 'Discard changes' }).click();
    await expect(discard).toBeHidden();
    await expect(page.getByText('Changes discarded.')).toBeVisible();
    await expect(page.getByText('Live', { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText('Live', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    // The button's words are what is live again.
    if ((await page.getByRole('button', { name: 'Edit the button' }).count()) === 0) {
      await page.getByRole('button', { name: 'Show preview' }).click();
    }
    await page.getByRole('button', { name: 'Edit the button' }).click();
    await expect(page.getByRole('textbox', { name: 'Button text' })).toHaveValue('Send');
  });
});
