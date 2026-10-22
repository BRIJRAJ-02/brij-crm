// Book by chat (spec 0042), end to end: a member makes a booking page; a
// visitor in a fresh browser opens /b/<key>, chooses Chat, taps an offered
// time, types a name and email, says yes to the read back and lands on the
// guest page; the member's Bookings shows it as booked by chat, with the
// conversation behind Chat. Keyboard only from the field on.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

test.use({ timezoneId: 'UTC', locale: 'en-GB' });

/** A UUID v7, as the app mints them. */
function uuidv7(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(random.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

/** Calls one oRPC procedure as the page's signed in person, from the app's own origin. */
async function rpc(page: Page, procedure: string, input: unknown): Promise<unknown> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`/api/rpc/${procedure}`, { data: { json: input }, headers: { origin } });
  expect(response.ok(), `${procedure}: ${await response.text()}`).toBe(true);
  return ((await response.json()) as { json: unknown }).json;
}

test('a visitor books by chat and the host sees the conversation (spec 0042)', async ({ page, browser }) => {
  const stamp = Date.now().toString(36);
  const slug = `chat-${stamp}`;
  await newWorkspace(page, `chat-${stamp}@example.com`, slug);
  const made = (await rpc(page, 'bookingPages/create', {
    workspace: slug,
    id: uuidv7(),
    title: 'Intro call',
    timeZone: 'UTC',
    mutationId: uuidv7(),
  })) as { publicKey: string };

  const visitor = await browser.newContext({ timezoneId: 'UTC', locale: 'en-GB' });
  const chat = await visitor.newPage();
  await chat.goto(`/b/${made.publicKey}`);
  const opened = Date.now();
  // The radio is a hidden input under its segment's icon, so the press goes to the segment, as a visitor's does.
  await chat.locator('label', { has: chat.getByRole('radio', { name: 'Book by chat' }) }).click();
  const log = chat.getByRole('log', { name: 'Conversation' });
  await expect(log).toContainText('I book Ada Lovelace’s Intro call (30 minutes).');

  // A tapped time goes as words the chat reads back to the same time.
  const firstDay = log.getByRole('list').first();
  await firstDay.getByRole('button').first().click();
  await expect(log).toContainText('it is. What’s your name and email?');

  const field = chat.getByRole('textbox', { name: 'Message' });
  await expect(field).toBeFocused();
  await field.fill('I’m Grace Hopper, grace@navy.example');
  await field.press('Enter');
  await expect(log).toContainText('for Grace Hopper (grace@navy.example). Shall I book it?');
  // The bot checks hold back a booking sent within 2 s of opening the page (MIN_FILL_MS); a person reads first.
  const reading = 2_500 - (Date.now() - opened);
  if (reading > 0) await chat.waitForTimeout(reading);
  await chat.getByRole('button', { name: 'Yes, book it' }).click();
  await expect(chat).toHaveURL(new RegExp(`/b/${made.publicKey}/manage\\?t=`));
  await expect(chat.getByRole('heading', { level: 1 })).toContainText(/booked/i);
  await visitor.close();

  // The list, not the week: the offered time may fall in a later week, and a 30 minute block hides its guest's name.
  await page.goto(`/w/${slug}/bookings/list`);
  const row = page.getByRole('listitem').filter({ hasText: 'Grace Hopper' });
  await row.getByRole('button', { name: 'Intro call' }).click();
  await expect(page.getByText('By chat on the booking page')).toBeVisible();
  await page.getByRole('button', { name: /^View chat/ }).click();
  await expect(page.getByText('I’m Grace Hopper, grace@navy.example')).toBeVisible();
});
