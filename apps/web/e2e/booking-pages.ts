// Helpers for the flows on booking pages, as the Bookings redesign draws them (lanes 5.1 to 5.7, November 2026): a new
// page is live at once (no draft, no Publish), its editor's Share section shows the address in a "Link" group, and
// the visitor's bar names the picked time ("Next · Tue, Nov 10 at 9:30 AM", "Request · …" on a page that confirms).
import { expect, type Page } from '@playwright/test';

/** The visitor's bar button once a time is picked: Next, or Request on a page that confirms each booking first. */
export const PICKED_TIME = /^(Next|Request) · /;

/**
 * The page's public address, read from its editor's Share section (`/captures/links/<id>?tab=share`): the "Link"
 * group's address, drawn as the origin and the slug side by side.
 */
export async function shareAddress(page: Page, editorUrl: string): Promise<string> {
  await page.goto(`${editorUrl.replace(/\?.*$/, '')}?tab=share`);
  const group = page.getByRole('group', { name: 'Link', exact: true }).first();
  await expect(group).toBeVisible();
  const address = await group.evaluate((element) => (element.firstElementChild?.textContent ?? '').trim());
  expect(address).toMatch(/^https?:\/\//);
  return address;
}

/** Picks Live or Hidden from the page's status pill (a card's or the editor's), and waits for its toast. */
export async function setPageStatus(page: Page, title: string, status: 'Live' | 'Hidden'): Promise<void> {
  await page
    .getByRole('button', { name: new RegExp(`^(Live|Hidden), status of ${title}$`) })
    .first()
    .click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${status}`) }).click();
  await expect(page.getByText(`${title} is ${status === 'Live' ? 'live' : 'hidden'}`).first()).toBeVisible();
}

/**
 * Opens a booking's popup from Bookings › Meetings' list (the redesign's meeting popup, named by its guest), and
 * answers it.
 */
export async function openBookingPopup(page: Page, guest: string) {
  await page
    .getByRole('region', { name: /meetings/i })
    .getByRole('button', { name: guest, exact: true })
    .first()
    .click();
  const popup = page.getByRole('dialog', { name: guest });
  await expect(popup).toBeVisible();
  return popup;
}

/** Chooses one of the popup's changes from its ⋯ ("More for <guest>"): Reschedule, Reassign, Cancel meeting, … */
export async function popupAction(page: Page, guest: string, action: string): Promise<void> {
  await page
    .getByRole('dialog', { name: guest })
    .getByRole('button', { name: `More for ${guest}` })
    .click();
  await page.getByRole('menuitem', { name: action }).click();
}

/** Meetings' People picker (the redesign's Select, named by its value then "People"): the reader, or the Whole team. */
export async function pickPeople(page: Page, who: string): Promise<void> {
  await page
    .getByRole('main')
    .getByRole('button', { name: / People$/ })
    .first()
    .click();
  await page.getByRole('option', { name: new RegExp(`^${who}`) }).click();
}
