// Availability schedules (spec 0035), end to end: the Availability tab opens the default in its editor; a member makes
// a second schedule from it, gives it evening hours (saved with the Unsaved changes bar's Save), picks it for a booking
// page, and the page's public slots follow it; a save in one browser shows in another browser's editor (AC-977);
// deleting it from the switcher asks first, naming the page it moves, Cancel changes nothing, and once it is gone the
// tab opens the default and the page books by it again (AC-964, AC-965, AC-967, AC-969, AC-970).
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

/** Every day that is on from `start` to `end`, through the week's quiet Set all days and its Popover. */
async function setAllDays(page: Page, start: string, end: string): Promise<void> {
  await page.getByRole('button', { name: 'Set all days' }).click();
  const popover = page.getByRole('dialog', { name: 'Set all days' });
  for (const [label, option] of [
    ['All days start', start],
    ['All days end', end],
  ] as const) {
    await popover.getByRole('button', { name: new RegExp(label) }).click();
    await page
      .getByRole('listbox', { name: label, exact: true })
      .getByRole('option', { name: option, exact: true })
      .click();
  }
  await popover.getByRole('button', { name: 'Apply' }).click();
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
    await page.getByRole('button', { name: 'Create page' }).click();
    await expect(page).toHaveURL(/captures\/links\/[0-9a-f-]{36}/, { timeout: 60_000 });
    const pageUrl = page.url();
    const key = /\/b\/([A-Za-z0-9_-]{16})/.exec((await page.getByLabel('Public link').inputValue()) || '')?.[1];
    // The schedule is on the Hours tab.
    await page.getByRole('tab', { name: 'Hours', exact: true }).click();
    await expect(page.getByRole('button', { name: /Working hours.*Default/ }).first()).toBeVisible();
    expect(key).toBeDefined();
    expect(await localStarts(page.request, key ?? '')).toEqual(halfHours(9, 17));

    // Availability opens the default in its editor; New schedule asks for a name and opens the new one there.
    await page.goto(`/w/${slug}/bookings/availability`);
    // The switcher: the open schedule's name, then ", default" on the default, then what it does.
    const switcher = (name: string) =>
      page.getByRole('button', { name: new RegExp(`^${name}(, default)?, switch schedule$`) });
    await expect(switcher('Working hours')).toBeVisible();
    await expect(page.getByText('Default', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'New schedule' }).click();
    const dialog = page.getByRole('dialog', { name: 'New schedule' });
    await dialog.getByLabel('Name').fill('Evenings');
    await dialog.getByRole('button', { name: 'Create schedule' }).click();
    await expect(page).toHaveURL(/availability\?schedule=[0-9a-f-]{36}$/);
    await expect(switcher('Evenings')).toBeVisible();
    const editorUrl = page.url();
    // Changes wait in the Unsaved changes bar until Save, said in a toast (the owner, 22 October 2026).
    await setAllDays(page, '6:00 PM', '8:00 PM');
    await expect(page.getByText('Saved Evenings.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved Evenings.').first()).toBeVisible();
    // Discard puts the saved hours back.
    await setAllDays(page, '6:00 PM', '7:00 PM');
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('button', { name: /Monday until/ }).first()).toContainText('8:00 PM');

    // The page picks Evenings, and its public slots follow.
    await page.goto(`${pageUrl}?tab=hours`);
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
    await expect(reader.getByRole('button', { name: /Monday until/ }).first()).toContainText('8:00 PM');
    // The page's Hours tab edits the schedule's week in place, saved by the page's own Save (the owner, 22 October
    // 2026), and says which other pages the change reaches; View page opens the live page in a new tab.
    await page.goto(`${pageUrl}?tab=hours`);
    await expect(page.getByRole('link', { name: 'View page' })).toHaveAttribute('href', new RegExp(`/b/${key ?? ''}$`));
    await setAllDays(page, '6:00 PM', '9:00 PM');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    if (!LIVE) await reader.reload();
    await expect(reader.getByRole('button', { name: /Monday until/ }).first()).toContainText('9:00 PM', {
      timeout: LIVE_MS,
    });
    await readerContext.close();
    expect(await localStarts(page.request, key ?? '')).toEqual(halfHours(18, 21));

    // Deleting from the switcher asks first, naming the page it moves; Cancel changes nothing.
    await page.goto(editorUrl);
    // Used by is rows now (availfix): a grid of the pages, each opening its editor.
    await expect(page.getByRole('grid', { name: 'Used by' })).toContainText('Intro call');
    const remove = async () => {
      await switcher('Evenings').click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      return page.getByRole('alertdialog', { name: 'Delete the Evenings schedule?' });
    };
    const confirm = await remove();
    await expect(confirm).toContainText('Intro call will use Working hours, your default, and this can’t be undone.');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await expect(switcher('Evenings')).toBeVisible();
    expect(await localStarts(page.request, key ?? '')).toEqual(halfHours(18, 21));

    // Delete schedule: gone, the tab opens the default, and the page books by it again.
    const again = await remove();
    await again.getByRole('button', { name: 'Delete schedule' }).click();
    await expect(again).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/bookings/availability$`));
    await expect(switcher('Working hours')).toBeVisible();
    await switcher('Working hours').click();
    await expect(page.getByRole('menuitemradio', { name: /Evenings/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(await localStarts(page.request, key ?? '')).toEqual(halfHours(9, 17));
  });
});
