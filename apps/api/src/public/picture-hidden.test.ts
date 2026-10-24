// Hide my photo on booking pages (owner ask A124, 23 Oct 2026), through the real app: a signed in person turns it on
// in Settings › Profile (`profile.update`), and every public answer about them, read by an anonymous visitor, names
// no picture: the page's facts (which the booking page, its embed and a handle address all read), the profile, a
// booking's answer, the guest page and the chat. Both picture routes then answer exactly as for a person with no
// picture, without fetching. Turned off, the picture is back at the same path.
import { newId, type BookingCalendar } from '@crm/core';
import { pictureVersion } from '@crm/core/public';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../app.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { APP_URL, TEST_EDGE_SECRET, testEnv, testServices } from '../testing.ts';
import { MAILPIT_URL, newIp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace } from '../../test/workspace.ts';
import { createMemoryLimiter } from './limits.ts';
import type { PictureFetch } from './picture.ts';

const GOOGLE = 'https://lh3.googleusercontent.com/a/ACg8ocK_hidden-123=s96-c';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const MONDAY_9 = '2026-11-02T09:00:00.000Z';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof createApp>;
const fetched: string[] = [];
const calendar: BookingCalendar = {
  busy: () => Promise.resolve({ status: 'read', busy: [] }),
  events: () => Promise.resolve({ meetingId: newId() }),
};

beforeAll(() => {
  ({ db, identity } = testConnections());
  const env = testEnv();
  // Google answers every picture as a small PNG; the test sees which URLs were asked for.
  const pictureFetch: PictureFetch = (url) => {
    fetched.push(url.href);
    return Promise.resolve({ ok: true, type: 'image/png', bytes: PNG });
  };
  app = createApp({
    services: {
      ...testServices(env, { db, identity, mailer: createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM }) }),
      bookingCalendar: calendar,
      bookingLimiter: createMemoryLimiter(),
      pictureFetch,
      now: () => NOW,
    },
    env,
  });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** A request as a visitor's browser sends it through the edge, with no session: `path` under `/api/public/`. */
function visit(path: string, body?: unknown) {
  return app.request(path.startsWith('/api/') ? path : `/api/public/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      [EDGE_HEADER]: TEST_EDGE_SECRET,
      'x-forwarded-for': newIp(),
      'content-type': 'application/json',
      [ORIGIN_HEADER]: APP_URL,
      origin: APP_URL,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** An answer's status and body as text, for reading and for searching. */
async function read(path: string, body?: unknown): Promise<{ readonly status: number; readonly text: string }> {
  const answer = await visit(path, body);
  return { status: answer.status, text: await answer.text() };
}

/** Everything a picture answer says: status, the headers a browser or the edge reads, and the body. */
async function pictureAnswer(path: string) {
  const answer = await visit(path);
  return {
    status: answer.status,
    type: answer.headers.get('content-type'),
    cache: answer.headers.get('cache-control'),
    body: await answer.text(),
  };
}

/** A signed in person whose account has a Google picture, with a handle and a personal booking page. */
async function host() {
  const m = await memberWithWorkspace(app);
  const [user] = await testQuery<{ id: string }>(ownerUrl, `select id::text from auth."user" where email = $1`, [
    m.email,
  ]);
  if (user === undefined) throw new Error('The signed in person has no account.');
  await testQuery(ownerUrl, `update auth."user" set image = $1 where id = $2`, [GOOGLE, user.id]);
  const handle = `ada-${newId().slice(-8)}`;
  await m.client.profile.update({ workspace: m.slug, handle, mutationId: newId() });
  const page = await m.client.bookingPages.create({
    workspace: m.slug,
    id: newId(),
    title: 'Intro call',
    timeZone: 'UTC',
    mutationId: newId(),
  });
  const version = pictureVersion(user.id, GOOGLE);
  return {
    m,
    handle,
    page,
    pagePicture: `/api/public/booking/${page.publicKey}/picture?v=${version}`,
    profilePicture: `/api/public/profiles/${handle}/picture?v=${version}`,
  };
}

describe('Hide my photo on booking pages (owner ask A124)', () => {
  it('takes the picture off every public answer an anonymous visitor reads, and puts it back', async () => {
    const { m, handle, page, pagePicture, profilePicture } = await host();
    expect((await m.client.profile.get({ workspace: m.slug })).pictureHidden).toBe(false);
    expect(JSON.parse((await read(`booking/${page.publicKey}`)).text)).toMatchObject({ hostImage: pagePicture });
    expect(JSON.parse((await read(`handles/${handle}`)).text)).toMatchObject({ image: profilePicture });
    expect((await pictureAnswer(pagePicture)).status).toBe(200);
    expect((await pictureAnswer(profilePicture)).status).toBe(200);
    // What a person with no picture gets at a picture path: the route's one "none" answer.
    const none = await pictureAnswer(`/api/public/booking/${page.publicKey}/picture?v=000000000000`);
    expect(none.status).toBe(404);

    // The contact card's vCard embeds the picture while it shows (AC-5114).
    await m.client.profile.saveItem({
      workspace: m.slug,
      id: newId(),
      block: { kind: 'contact', fullName: 'Ada' },
      mutationId: newId(),
    });
    const shownCard = (await read(`handles/${handle}/contact.vcf`)).text.replace(/\r\n /g, '');
    expect(shownCard).toContain(`PHOTO;ENCODING=b;TYPE=PNG:${Buffer.from(PNG).toString('base64')}`);

    const hidden = await m.client.profile.update({ workspace: m.slug, pictureHidden: true, mutationId: newId() });
    expect(hidden).toMatchObject({ pictureHidden: true, handle });
    expect((await m.client.profile.get({ workspace: m.slug })).pictureHidden).toBe(true);

    const before = fetched.length;
    // The page's facts: what the booking page, its embed (`?embed=1` is the page's own) and a handle address read.
    const facts = await read(`booking/${page.publicKey}`);
    expect(facts.status).toBe(200);
    expect(JSON.parse(facts.text)).not.toHaveProperty('hostImage');
    expect(JSON.parse(facts.text)).toMatchObject({ title: 'Intro call', hostName: 'Ada' });
    expect(facts.text).not.toContain('picture');
    const address = await read(`handles/${handle}/${page.slug}`);
    expect(JSON.parse(address.text)).toEqual({ publicKey: page.publicKey, handle, slug: page.slug });
    // The profile: initials, never the picture.
    const profile = await read(`handles/${handle}`);
    expect(profile.status).toBe(200);
    expect(JSON.parse(profile.text)).not.toHaveProperty('image');
    expect(JSON.parse(profile.text)).toMatchObject({ handle, initials: expect.any(String) as unknown });
    expect(profile.text).not.toContain('picture');
    // Both picture routes answer exactly as for a person with none: no hint that one exists, and Google not asked.
    expect(await pictureAnswer(pagePicture)).toEqual(none);
    expect(await pictureAnswer(profilePicture)).toEqual(none);
    // The vCard: the card without its picture.
    const hiddenCard = await read(`handles/${handle}/contact.vcf`);
    expect(hiddenCard.status).toBe(200);
    expect(hiddenCard.text).toContain('FN:Ada');
    expect(hiddenCard.text).not.toContain('PHOTO');
    expect(fetched.length).toBe(before);

    // A booking's answer, its guest page and the chat name no picture either.
    const booked = await read(`booking/${page.publicKey}/book`, {
      idempotencyKey: newId(),
      start: MONDAY_9,
      duration: 30,
      name: 'Grace Hopper',
      email: 'grace@navy.example',
      timeZone: 'America/New_York',
      company_url: '',
      startedAt: NOW.getTime() - 60_000,
    });
    expect(booked.status).toBe(200);
    expect(booked.text).not.toContain('picture');
    const { manageToken } = JSON.parse(booked.text) as { manageToken: string };
    const managed = await read(`booking/manage/${manageToken}`);
    expect(managed.status).toBe(200);
    expect(managed.text).not.toContain('picture');
    const chat = await read(`booking/${page.publicKey}/chat`, {
      conversationId: newId(),
      duration: 30,
      timeZone: 'UTC',
      hour12: true,
      messages: [{ role: 'visitor', text: 'Hi' }],
      startedAt: NOW.getTime() - 60_000,
    });
    expect(chat.status).toBe(200);
    expect(chat.text).not.toContain('picture');

    // Shown again: the same paths as before, since the picture itself didn't change.
    const shown = await m.client.profile.update({ workspace: m.slug, pictureHidden: false, mutationId: newId() });
    expect(shown.pictureHidden).toBe(false);
    expect(JSON.parse((await read(`booking/${page.publicKey}`)).text)).toMatchObject({ hostImage: pagePicture });
    expect(JSON.parse((await read(`handles/${handle}`)).text)).toMatchObject({ image: profilePicture });
    expect((await pictureAnswer(pagePicture)).status).toBe(200);
    expect((await pictureAnswer(profilePicture)).status).toBe(200);
  });

  it('takes only a true or false, and changes the caller’s own choice alone', async () => {
    const ada = await host();
    const bea = await host();
    const refused = await failure(() =>
      ada.m.client.profile.update({
        workspace: ada.m.slug,
        // A wrong type, as a hand made request could send it.
        pictureHidden: 'yes' as unknown as boolean,
        mutationId: newId(),
      }),
    );
    expect(refused.code).toBe('INPUT_INVALID');
    expect((await ada.m.client.profile.get({ workspace: ada.m.slug })).pictureHidden).toBe(false);
    // Bea hides hers; Ada's pages keep Ada's picture.
    await bea.m.client.profile.update({ workspace: bea.m.slug, pictureHidden: true, mutationId: newId() });
    expect(JSON.parse((await read(`booking/${ada.page.publicKey}`)).text)).toMatchObject({
      hostImage: ada.pagePicture,
    });
    expect(JSON.parse((await read(`booking/${bea.page.publicKey}`)).text)).not.toHaveProperty('hostImage');
    // Someone signed in elsewhere can't reach Bea's workspace to change anything there.
    const outside = await failure(() =>
      ada.m.client.profile.update({ workspace: bea.m.slug, pictureHidden: false, mutationId: newId() }),
    );
    expect(outside.code).toBe('NOT_FOUND');
    expect((await bea.m.client.profile.get({ workspace: bea.m.slug })).pictureHidden).toBe(true);
  });
});
