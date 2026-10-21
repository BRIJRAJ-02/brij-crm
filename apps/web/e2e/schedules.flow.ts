// Availability schedules (spec 0035), end to end: a member makes a second schedule from Availability, gives it evening
// hours, picks it for a booking page, and the page's public slots follow it; a save in one browser shows in another
// browser's editor (AC-977); deleting it asks first, naming the page it moves, Cancel changes nothing, and once it is
// gone the page books by the default again (AC-964, AC-965, AC-967, AC-969, AC-970).
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { newWorkspace, signInAgain } from './people.ts';

/** How long a change may take to show in the other browser (AC-977 says 1 second; the flow allows for a busy machine). */
const LIVE_MS = 5_000;

/**
 * Whether live updates reach the browsers: Centrifugo admits only the app on :5173, so a run on another port
 * (`FLOW_LIVE=off`) reloads the second browser where it would otherwise watch the change arrive.
 */
const LIVE = process.env.FLOW_LIVE !== 'off';

const ZONE = 'America/New_York';

/** Picks `option` in the Select labelled `label`, inside the listbox it opened. */
async function pick(page: Page, label: string, option: string): Promise<void> {
  // The Select's trigger, not the "About …" button of an InfoTip beside its label (the tips lane).
  await page
    .getByRole('button', { name: new RegExp(`^(?!About ).*${label}`) })
    .first()
    .click();
  await page
    .getByRole('listbox', { name: label, exact: true })
    .getByRole('option', { name: option, exact: true })
    .click();
}

/** The distinct local start times (New York) the page offers over the next week, as its public page reads them. */
async function localStarts(request: APIRequestContext, key: string): Promise<readonly string[]> {
  const from = new Date(Date.now() + 2 * 86_400_000);
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), duration: '30', tz: ZONE });
  const answer = (await (await request.get(`/api/public/booking/${key}/slots?${query.toString()}`)).json()) as {
    readonly slots: readonly { readonly start: string }[];
  };
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' });
  return [...new Set(answer.slots.map((slot) => clock.format(new Date(slot.start))))].sort();
}

const halfHours = (from: number, to: number) =>
  Array.from({ length: (to - from) * 2 }, (_, index) => {
    const minutes = from * 60 + index * 30;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  });

test.describe('availability schedules', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The schedules flow runs at desktop width.');
  test.use({ timezoneId: ZONE, locale: 'en-US' });

  test('makes a schedule, books a page by it, follows a save live, and deletes it after a confirm', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const email = `schedules-${tag}@example.com`;
    const slug = `schedules-${tag}`;
    const code = await newWorkspace(page, email, slug);

    // A booking page, which follows the default: the virtual "Working hours", weekdays 9 to 5 in New York.
    await page.goto(`/w/${slug}/captures/links`);
    await page.getByRole('button', { name: 'New booking page' }).first().click();
    await page.getByLabel('Title').fill('Intro call');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/captures\/links\/[0-9a-f-]{36}/, { timeout: 60_000 });
    const pageUrl = page.url();
    await expect(page.getByText('Default schedule (Working hours)').first()).toBeVisible();
    const key = /\/b\/([A-Za-z0-9_-]{16})/.exec((await page.getByLabel('Public link').inputValue()) || '')?.[1];
    expect(key).toBeDefined();
    expect(await localStarts(page.request, key ?? '')).toEqual(halfHours(9, 17));

    // Availability lists the default; New schedule asks for a name and opens the new one.
    await page.goto(`/w/${slug}/bookings/availability`);
    const schedules = page.getByRole('grid', { name: 'Schedules' });
    await expect(schedules.getByRole('row').filter({ hasText: 'Working hours' })).toContainText('Default');
    await page.getByRole('button', { name: 'New schedule' }).click();
    const dialog = page.getByRole('dialog', { name: 'New schedule' });
    await dialog.getByLabel('Name').fill('Evenings');
    await dialog.getByRole('button', { name: 'Create schedule' }).click();
    await expect(page).toHaveURL(/availability\/[0-9a-f-]{36}$/);
    const editorUrl = page.url();
    await pick(page, 'All days start', '6:00 PM');
    await pick(page, 'All days end', '8:00 PM');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    // The page picks Evenings, and its public slots follow.
    await page.goto(pageUrl);
    await pick(page, 'Schedule', 'Evenings');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    expect(await localStarts(page.request, key ?? '')).toEqual(halfHours(18, 20));

    // A second browser on the same schedule's editor sees a save from the first (AC-977).
    const readerContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: testInfo.project.use.viewport ?? null,
      timezoneId: ZONE,
      locale: 'en-US',
    });
    const reader = await readerContext.newPage();
    await signInAgain(reader, email, editorUrl, [code]).catch(async () => {
      await reader.goto(editorUrl);
    });
    await expect(reader.getByRole('button', { name: /All days end/ }).first()).toContainText('8:00 PM');
    await page.goto(editorUrl);
    await pick(page, 'All days end', '9:00 PM');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    if (!LIVE) await reader.reload();
    await expect(reader.getByRole('button', { name: /All days end/ }).first()).toContainText('9:00 PM', {
      timeout: LIVE_MS,
    });
    await readerContext.close();
    expect(await localStarts(page.request, key ?? '')).toEqual(halfHours(18, 21));

    // Deleting asks first, naming the page it moves; Cancel changes nothing.
    await page.goto(`/w/${slug}/bookings/availability`);
    const evenings = schedules.getByRole('row').filter({ hasText: 'Evenings' });
    await expect(evenings).toContainText('Used by 1 booking page');
    const remove = async () => {
      await evenings.getByRole('button', { name: 'More for Evenings' }).click();
      await page.getByRole('menu', { name: 'More for Evenings' }).getByRole('menuitem', { name: 'Delete' }).click();
      return page.getByRole('alertdialog', { name: 'Delete the Evenings schedule?' });
    };
    const confirm = await remove();
    await expect(confirm).toContainText(
      'Intro call, the one booking page that uses it, will book by Working hours, your default, and this can’t be undone.',
    );
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await expect(evenings).toBeVisible();
    expect(await localStarts(page.request, key ?? '')).toEqual(halfHours(18, 21));

    // Delete schedule: gone, and the page books by the default again.
    const again = await remove();
    await again.getByRole('button', { name: 'Delete schedule' }).click();
    await expect(again).toBeHidden();
    await expect(evenings).toHaveCount(0);
    expect(await localStarts(page.request, key ?? '')).toEqual(halfHours(9, 17));
  });
});
