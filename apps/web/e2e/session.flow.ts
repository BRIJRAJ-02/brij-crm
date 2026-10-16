// The session ending mid use (spec 0005, AC-31, milestone 4): the person's
// session is gone (its cookie cleared, which the API answers exactly as an
// expired one: 401 UNAUTHENTICATED) while they edit a cell. The edit rolls
// back, a notice says it wasn't saved, and the app goes to
// /sign-in?redirect=<the page> with nothing of the workspace left on screen.
// Signing in again lands on the same page, read fresh: the lost edit is not
// there. A session that ends while nothing is being written just goes to sign
// in when the next page asks.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { codeFor } from './mailpit.ts';
import { addPerson, cellAt, checkScreen, newWorkspace } from './people.ts';

const UNSAVED = 'You were signed out, so your last change wasn’t saved. Sign in again to carry on.';

test.describe('the session ending', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('rolls back an edit in flight, says so, and comes back to the same page after signing in', async ({
    page,
    context,
  }) => {
    const tag = randomUUID().slice(0, 8);
    const email = `session-${tag}@example.com`;
    const slug = `session-${tag}`;
    const firstCode = await newWorkspace(page, email, slug);
    // People's address opened its default view (spec 0020, AC-462): the page to come back to.
    const people = new URL(page.url()).pathname;
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
    const title = await cellAt(page, 0, 'Job title');
    await title.click();
    await page.keyboard.type('Rear admiral');
    await page.keyboard.press('Enter');
    await expect(title).toContainText('Rear admiral');

    // The session ends: the next write is answered 401.
    await context.clearCookies();
    const again = await cellAt(page, 0, 'Job title');
    await again.click();
    await page.keyboard.type('Commodore');
    await page.keyboard.press('Enter');

    // Off to sign in, keeping the page, with the notice saying the change was lost.
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?redirect=${encodeURIComponent(people)}$`));
    // Said once, on the sign in form itself (not a toast that leaves): the address has already dropped why.
    await expect(page.getByRole('main').getByText(UNSAVED)).toBeVisible();
    await expect(page.getByText(UNSAVED)).toHaveCount(1);
    await expect(page.getByLabel('Email')).toBeFocused();
    // Nothing of the workspace stays on screen behind sign in.
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('grid')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('Grace Hopper');
    await checkScreen(page, 'session-ended');

    // Signing in again lands on the same page, read fresh: the saved edit is there, the lost one isn't.
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page).toHaveURL(/\/verify/);
    await page.getByLabel('Code').fill(await codeFor(page.request, email, [firstCode]));
    await expect(page).toHaveURL(new RegExp(`${people}$`));
    const back = await cellAt(page, 0, 'Job title');
    await expect(back).toContainText('Rear admiral');
    await expect(back).not.toContainText('Commodore');
  });

  test('a session that ended while idle goes to sign in on the next page, with no notice of a lost change', async ({
    page,
    context,
  }) => {
    const tag = randomUUID().slice(0, 8);
    const slug = `idle-${tag}`;
    await newWorkspace(page, `idle-${tag}@example.com`, slug);
    const people = new URL(page.url()).pathname;
    await context.clearCookies();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?redirect=${encodeURIComponent(people)}$`));
    await expect(page.getByLabel('Email')).toBeFocused();
    await expect(page.getByText(UNSAVED)).toHaveCount(0);
  });
});
