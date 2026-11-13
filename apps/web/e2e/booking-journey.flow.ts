// The booking journey end to end, as an owner and a visitor live it (flow walks, 29 October 2026): Bookings › New
// makes a page and opens it under Captures › Links, live at once; Questions files a required question on People
// and the save bar clears; a visitor in a browser of their own books, is held on the unanswered question, answers
// it, moves the booking and cancels it; the host sees the booking with its answer, then sees it cancelled.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';
import { openBookingPopup, PICKED_TIME, shareAddress } from './booking-pages.ts';

/** The booking page's bot check wants a human's pace before Confirm. */
const HUMAN_PACE_MS = 3_500;

test.describe('the booking journey', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough for the journey.');

  test('make a page, ask a question, book, move and cancel as a visitor, and follow it as the host', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `bookjourney-${tag}`;
    await newWorkspace(page, `bookjourney-${tag}@example.com`, slug);

    // Captures › New: one dialog, then the page itself, live with no publish step.
    // New booking page lives on Captures › Links; Bookings' own New is New meeting once a page exists.
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Captures', exact: true })
      .click();
    await page.getByRole('button', { name: /^New booking page/ }).click();
    const create = page.getByRole('dialog', { name: 'New booking page' });
    await expect(create.getByLabel('Title')).toBeFocused();
    await create.getByLabel('Title').fill('Intro call');
    await create.getByRole('button', { name: 'Create page' }).click();
    // Create page goes straight on to the editor, the page live at once (no draft or Publish since 9 November 2026).
    await expect(page).toHaveURL(/\/captures\/links\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const editor = page.url();
    await expect(page.getByRole('navigation', { name: 'Page sections' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Live, status of Intro call' })).toHaveCount(1);

    // Questions: answers go to People, and a required question is filed on a new People attribute.
    await page.getByRole('navigation', { name: 'Page sections' }).getByRole('link', { name: 'Questions' }).click();
    await expect(page.getByRole('button', { name: /Where the answers go/ })).toContainText('People');
    await page.getByRole('button', { name: 'Add a question', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Short text' }).click();
    await page.getByLabel('Question', { exact: true }).fill('What do you want to cover?');
    // A new question is kept with the booking until the host says otherwise (B3); here they file it on People, from
    // the question's ⋯ (T40).
    await page.getByRole('button', { name: 'More for What do you want to cover?' }).click();
    await page.getByRole('menuitem', { name: /^Save answer to/ }).click();
    await page.getByRole('menuitem', { name: /^New field on/ }).click();
    // A switch's input sits under its drawn track: focus it and press Space, as a keyboard does.
    await page.getByRole('switch', { name: 'Required' }).focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText('Added 1 field to Person.')).toBeVisible();
    // Saved means saved: Save changes rests once the question is filed (late trap #58).
    // The bar's Publish goes once nothing is left to publish (spec 0074).
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0, { timeout: 10_000 });
    // The Share section shows the address, with Copy link beside it.
    const address = await shareAddress(page, editor);

    // The visitor: a browser of their own, signed in to nothing.
    const visitorContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const visitor = await visitorContext.newPage();
    await visitor.goto(address);
    const times = visitor.getByRole('list', { name: /^Times on / }).getByRole('button');
    await times.first().click();
    await visitor.getByRole('button', { name: PICKED_TIME }).click();
    await visitor.getByLabel('Your name').fill('Vera Visitor');
    await visitor.getByLabel('Email').fill(`vera-${tag}@example.com`);
    await visitor.waitForTimeout(HUMAN_PACE_MS);
    // Held on the question it skipped, in place, and nothing booked.
    await visitor.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(visitor.getByText('Answer this question.')).toBeVisible();
    await expect(visitor).not.toHaveURL(/\/manage\?/);
    await visitor.getByLabel('What do you want to cover?').fill('Pricing and onboarding');
    await visitor.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(visitor).toHaveURL(/\/manage\?/, { timeout: 30_000 });
    await expect(visitor.getByText('You’re booked')).toBeVisible();

    // The host: the booking in Bookings › List, with the visitor's answer beside it.
    await page.goto(`/w/${slug}/bookings/list`);
    const panel = await openBookingPopup(page, 'Vera Visitor');
    await expect(panel).toContainText('Intro call');
    await expect(panel).toContainText('Pricing and onboarding');
    await page.keyboard.press('Escape');

    // The visitor moves it: the picker leaves out the time they hold, and the page says it moved.
    await visitor.getByRole('button', { name: 'Reschedule' }).click();
    await visitor
      .getByRole('list', { name: /^Times on / })
      .getByRole('button')
      .last()
      .click();
    await visitor.getByRole('button', { name: /^Move to \d/ }).click();
    await expect(visitor.getByText('Moved.')).toBeVisible({ timeout: 15_000 });

    // Then cancels it, asked first, with a reason the host reads.
    // The card's foot: Reschedule, Guests and a quiet Cancel, whose confirm says Cancel booking.
    await visitor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(visitor.getByText(/^Cancel Intro call with /)).toBeVisible();
    await visitor.getByLabel('Reason').fill('Something came up');
    await visitor.getByRole('button', { name: 'Cancel booking' }).last().click();
    await expect(visitor.getByRole('button', { name: 'Reschedule' })).toBeHidden({ timeout: 15_000 });

    // The host's list no longer holds it as upcoming; Cancelled does.
    await page.reload();
    await expect(page.getByText('Intro call')).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole('radio', { name: 'Cancelled' }).click({ force: true });
    await expect(page.getByText('Intro call').first()).toBeVisible();
    await visitorContext.close();
  });
});
