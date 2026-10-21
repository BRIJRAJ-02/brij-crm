// The booking chat through the real app (spec 0041), with a fake calendar, a
// fixed clock and the real Postgres: a booking made by typing, through the
// same booking service as the form; a retried turn answering the same booking;
// the transcript kept on the booking for members and never on the guest page;
// a typed email of a known person answered like any other; the limits; and
// bad input.
import { newId, type BookingCalendar } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { APP_URL, TEST_EDGE_SECRET, testEnv, testServices } from '../testing.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { MAILPIT_URL, newIp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace } from '../../test/workspace.ts';
import { createMemoryLimiter } from './limits.ts';

/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const MONDAY_9 = '2026-11-02T09:00:00.000Z';

let db: Database;
let identity: IdentityStore;
const calendar: BookingCalendar = {
  busy: () => Promise.resolve({ status: 'read', busy: [] }),
  events: () => Promise.resolve({ meetingId: newId() }),
};
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  ({ db, identity } = testConnections());
  const env = testEnv();
  app = createApp({
    services: {
      ...testServices(env, { db, identity, mailer: createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM }) }),
      bookingCalendar: calendar,
      bookingLimiter: createMemoryLimiter(),
      now: () => NOW,
    },
    env,
  });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

type Line = { readonly role: 'visitor' | 'assistant'; readonly text: string };
type Reply = {
  text: string;
  offers: string[];
  suggestions: string[];
  duration: number;
  booked?: { manageToken: string; booking: { start: string } };
};

/** One chat turn as the page sends it. */
function turn(
  publicKey: string,
  lines: readonly Line[],
  init: { conversationId?: string; ip?: string; origin?: string; body?: unknown } = {},
) {
  return app.request(`/api/public/booking/${publicKey}/chat`, {
    method: 'POST',
    headers: {
      [EDGE_HEADER]: TEST_EDGE_SECRET,
      'x-forwarded-for': init.ip ?? newIp(),
      'content-type': 'application/json',
      [ORIGIN_HEADER]: init.origin ?? APP_URL,
      origin: init.origin ?? APP_URL,
    },
    body: JSON.stringify(
      init.body ?? {
        conversationId: init.conversationId ?? newId(),
        duration: 30,
        timeZone: 'UTC',
        hour12: true,
        messages: lines,
      },
    ),
  });
}

/** Plays the visitor's lines in order, the way the page does, keeping the assistant's replies in the thread. */
async function chat(publicKey: string, said: readonly string[], conversationId = newId()) {
  let lines: Line[] = [];
  let reply: Reply | undefined;
  for (const text of said) {
    lines = [...lines, { role: 'visitor', text }];
    const answer = await turn(publicKey, lines, { conversationId });
    expect(answer.status).toBe(200);
    reply = (await answer.json()) as Reply;
    lines = [...lines, { role: 'assistant', text: reply.text }];
  }
  return { reply: reply as Reply, lines, conversationId };
}

async function pageOf(m: Awaited<ReturnType<typeof memberWithWorkspace>>) {
  return m.client.bookingPages.create({
    workspace: m.slug,
    id: newId(),
    title: 'Intro call',
    timeZone: 'UTC',
    mutationId: newId(),
  });
}

describe('booking by chat (AC-1513 to AC-1522)', () => {
  it('books by typing through the booking service, and a retried turn answers the same booking', async () => {
    const m = await memberWithWorkspace(app);
    const page = await pageOf(m);
    const first = await chat(page.publicKey, ['monday at 9am']);
    expect(first.reply.text).toBe('Great, tomorrow at 9:00 AM it is. What’s your name and email?');

    const readBack = await chat(
      page.publicKey,
      ['monday at 9am', "I'm Grace Hopper, grace@navy.example"],
      first.conversationId,
    );
    expect(readBack.reply.text).toBe(
      'Tomorrow at 9:00 AM, 30 minutes, for Grace Hopper (grace@navy.example). Shall I book it?',
    );
    expect(readBack.reply.booked).toBeUndefined();

    const said = ['monday at 9am', "I'm Grace Hopper, grace@navy.example", 'Yes, book it'];
    const done = await chat(page.publicKey, said, first.conversationId);
    expect(done.reply.text).toBe(
      'Done. You’re booked for tomorrow at 9:00 AM. The details are on their way to grace@navy.example.',
    );
    expect(done.reply.booked?.booking.start).toBe(MONDAY_9);
    const token = done.reply.booked?.manageToken ?? '';

    // The same last turn again (a retry) answers the booking it made, not a second one.
    const again = await turn(page.publicKey, done.lines.slice(0, -1), { conversationId: first.conversationId });
    expect(((await again.json()) as Reply).booked?.manageToken).toBe(token);
    const listed = await m.client.bookings.listAll({ workspace: m.slug, when: 'upcoming' });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ visitorName: 'Grace Hopper', guests: [] });
    expect(listed[0]?.personRecordId).toBeDefined();
    // Members see the conversation; the guest page never does.
    expect(listed[0]?.chat?.map((line) => line.role)).toEqual([
      'visitor',
      'assistant',
      'visitor',
      'assistant',
      'visitor',
    ]);
    expect(listed[0]?.chat?.[0]).toEqual({ role: 'visitor', text: 'monday at 9am' });
    const managed = await app.request(`/api/public/booking/manage/${token}`, {
      headers: { [EDGE_HEADER]: TEST_EDGE_SECRET, 'x-forwarded-for': newIp() },
    });
    const guestPage = await managed.text();
    expect(guestPage).toContain('Grace Hopper');
    expect(guestPage).not.toContain('Shall I book it');
    expect(guestPage).not.toContain('monday at 9am');

    // The booked time is no longer offered to anyone.
    const next = await chat(page.publicKey, ['monday at 9am']);
    expect(next.reply.offers).not.toContain(MONDAY_9);
    expect(next.reply.text).toMatch(/^That time isn’t open\./);
  });

  it('keeps nothing for a conversation that never books', async () => {
    const m = await memberWithWorkspace(app);
    const page = await pageOf(m);
    await chat(page.publicKey, ['tuesday afternoon', 'the first one', "I'm Ann, ann@example.com"]);
    expect(await m.client.bookings.listAll({ workspace: m.slug, when: 'upcoming' })).toEqual([]);
  });

  it('answers a typed email of a known person exactly as a new one (AC-1518)', async () => {
    const m = await memberWithWorkspace(app);
    const page = await pageOf(m);
    await chat(page.publicKey, ['monday at 10am', "I'm Grace Hopper, grace@navy.example", 'yes']);
    const known = await chat(page.publicKey, ['tuesday at 10am', "I'm Grace Hopper, grace@navy.example"]);
    const stranger = await chat(page.publicKey, ['tuesday at 10am', "I'm Grace Hopper, zed@new.example"]);
    expect(known.reply.text.replace('grace@navy.example', 'EMAIL')).toBe(
      stranger.reply.text.replace('zed@new.example', 'EMAIL'),
    );
    expect(known.reply.offers).toEqual(stranger.reply.offers);
    expect(known.reply.text).not.toMatch(/again|welcome back|already/i);
  });

  it('limits turns per address with Retry-After, and refuses bad input and foreign origins', async () => {
    const m = await memberWithWorkspace(app);
    const page = await pageOf(m);
    const ip = newIp();
    const lines: Line[] = [{ role: 'visitor', text: 'hello' }];
    for (let count = 0; count < 30; count += 1) {
      expect((await turn(page.publicKey, lines, { ip })).status).toBe(200);
    }
    const limited = await turn(page.publicKey, lines, { ip });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

    const assistantLast = await turn(page.publicKey, [...lines, { role: 'assistant', text: 'Hi' }]);
    expect(assistantLast.status).toBe(400);
    expect(await assistantLast.json()).toMatchObject({ code: 'INPUT_INVALID' });
    expect((await turn(page.publicKey, [{ role: 'visitor', text: 'x'.repeat(501) }])).status).toBe(400);
    const tooMany = Array.from({ length: 41 }, (): Line => ({ role: 'visitor', text: 'hi' }));
    expect((await turn(page.publicKey, tooMany)).status).toBe(400);
    expect((await turn(page.publicKey, lines, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await turn('AAAAAAAAAAAAAAAA', lines)).status).toBe(404);
  });
});
