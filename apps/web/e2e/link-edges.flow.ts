// The link page journey's edges (flow walks, phase 4, 29 October 2026): the same question asked twice is refused
// in the editor, before anything is sent, and writing, questions and a testimonial reach the visitor; archiving a
// block is one press with Undo, takes it off the visitor's page, and Restore puts it back, while Delete asks first;
// a section that folds reaches the visitor shut; and a Timefix form with no forms yet says so and offers the way to
// make one rather than an empty picker.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

/** A new workspace on its link page, in Edit page, and the public address a visitor opens. */
async function editing(page: Page, kind: string): Promise<{ slug: string; publicPage: string }> {
  const tag = randomUUID().slice(0, 8);
  const slug = `link${kind}-${tag}`;
  await newWorkspace(page, `link${kind}-${tag}@example.com`, slug);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Link page', exact: true })
    .click();
  const publicPage = await page
    .getByRole('group', { name: 'Share online' })
    .getByRole('link', { name: 'Open' })
    .getAttribute('href');
  await page.getByRole('button', { name: 'Edit page' }).click();
  await expect(page).toHaveURL(/edit=true/);
  return { slug, publicPage: publicPage ?? '' };
}

/** The Add modal, on one kind. */
async function adding(page: Page, kind: RegExp) {
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add to your link page' });
  await add.getByRole('radio', { name: kind }).check({ force: true });
  return add;
}

/** A link by its address alone, its title the site. */
async function addLink(page: Page, address: string) {
  const add = await adding(page, /^Link/);
  await add.getByLabel('Address').fill(address);
  await add.getByRole('button', { name: /^Add item/ }).click();
  await expect(add).toBeHidden();
}

test.describe('the link page journey’s edges', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The editor runs at desktop width.');

  test('writing, questions and a testimonial reach the visitor; a question asked twice is refused first', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const { publicPage } = await editing(page, 'words');

    const writing = await adding(page, /^Writing/);
    await writing.getByLabel('Your words').fill('I build booking flows for small studios.');
    await writing.getByRole('button', { name: /^Add item/ }).click();
    await expect(writing).toBeHidden();

    // It opens on its first question, ready to type.
    const faq = await adding(page, /^Questions/);
    await faq.getByLabel('Question', { exact: true }).fill('Do you travel?');
    await faq.getByLabel('Answer').fill('Yes, anywhere in town.');
    await faq.getByRole('button', { name: 'Add a question' }).click();
    await faq.getByLabel('Question', { exact: true }).fill('do you travel? ');
    await faq.getByLabel('Answer').fill('Twice, apparently.');
    await faq.getByRole('button', { name: /^Add item/ }).click();
    // Refused in the dialog, which stays open on the question to fix.
    await expect(faq.getByText('You already asked that one.')).toBeVisible();
    await expect(faq).toBeVisible();
    // The refused one is marked, so the fix lands on the right question.
    const repeated = faq.getByLabel('Question', { exact: true }).and(faq.locator('[aria-invalid="true"]'));
    await expect(repeated).toHaveValue('do you travel? ');
    await repeated.fill('How long is a session?');
    await faq.getByRole('button', { name: /^Add item/ }).click();
    await expect(faq).toBeHidden();

    const quote = await adding(page, /^Testimonial/);
    await quote.getByLabel('What they said').fill('Booking went from three emails to one link.');
    await quote.getByLabel('Who said it').fill('Priya Raman');
    await quote.getByRole('button', { name: /^Add item/ }).click();
    await expect(quote).toBeHidden();
    await page.getByRole('button', { name: 'Done' }).click();

    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(publicPage);
    await expect(visitor.getByText('I build booking flows for small studios.')).toBeVisible();
    // Questions start shut, and open on a press.
    const asked = visitor.getByRole('button', { name: 'Do you travel?' });
    await expect(asked).toHaveAttribute('aria-expanded', 'false');
    await asked.click();
    await expect(visitor.getByText('Yes, anywhere in town.')).toBeVisible();
    await expect(visitor.getByText('Booking went from three emails to one link.')).toBeVisible();
    await expect(visitor.getByText('Priya Raman')).toBeVisible();
    await visitor.context().close();
  });

  test('archive is one press with Undo and leaves the visitor’s page; Restore puts it back; Delete asks first', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const { publicPage } = await editing(page, 'archive');
    await addLink(page, 'portfolio.example.com');
    await addLink(page, 'shop.example.com');

    await page.getByRole('button', { name: 'More for portfolio.example.com' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await expect(page.getByText('portfolio.example.com archived.')).toBeVisible();
    const archived = page.getByRole('grid', { name: 'Archived' });
    await expect(archived.getByRole('row', { name: 'portfolio.example.com' })).toBeVisible();

    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(publicPage);
    await expect(visitor.getByRole('link', { name: /^shop\.example\.com/ })).toBeVisible();
    await expect(visitor.getByRole('link', { name: /^portfolio\.example\.com/ })).toHaveCount(0);

    await archived.getByRole('button', { name: 'Restore' }).click();
    await expect(archived).toBeHidden();
    await visitor.reload();
    await expect(visitor.getByRole('link', { name: /^portfolio\.example\.com/ })).toBeVisible();

    // Delete is for good, so it asks; Cancel keeps it.
    await page.getByRole('button', { name: 'More for shop.example.com' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete shop.example.com?' });
    await expect(confirm).toContainText('Archive keeps it instead.');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await page.getByRole('button', { name: 'More for shop.example.com' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await confirm.getByRole('button', { name: 'Delete block' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('button', { name: 'More for shop.example.com' })).toHaveCount(0);
    await visitor.reload();
    await expect(visitor.getByRole('link', { name: /^shop\.example\.com/ })).toHaveCount(0);
    await visitor.context().close();
  });

  test('a section that folds reaches the visitor shut, with its links inside', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { publicPage } = await editing(page, 'fold');
    const section = await adding(page, /^Section/);
    await section.getByLabel('Section name').fill('Work');
    await section.getByRole('radio', { name: 'Folds shut' }).check({ force: true });
    await section.getByRole('button', { name: /^Add item/ }).click();
    await expect(section).toBeHidden();
    await addLink(page, 'portfolio.example.com');
    await page.getByRole('button', { name: 'Done' }).click();

    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(publicPage);
    const fold = visitor.getByRole('button', { name: /^Work/ });
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(visitor.getByRole('link', { name: /^portfolio\.example\.com/ })).toBeHidden();
    await fold.click();
    await expect(visitor.getByRole('link', { name: /^portfolio\.example\.com/ })).toBeVisible();
    await visitor.context().close();
  });

  test('a Timefix form with no forms yet says so and offers the way to make one', async ({ page }) => {
    test.setTimeout(120_000);
    const { slug } = await editing(page, 'noform');
    const add = await adding(page, /^Timefix form/);
    await expect(add.getByText('You have no forms in this workspace yet')).toBeVisible();
    await add.getByRole('link', { name: 'Go to Forms' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/captures/forms`));
  });
});
