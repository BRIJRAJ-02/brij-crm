// Bento cards (spec 0068, AC-6808), against the real Postgres: each new kind saved, stored lean and read by a
// visitor as the public answer draws it; a span on every kind but a heading and a banner; the caps; an audio intro
// that must name one of the owner's recordings and never a picture (and a picture slot never a recording); another
// person's picture refused; and a recording served only while a published block names it.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import type { ProfileBlock } from '@crm/contracts';
import { enterLinkImage as liveEnterLinkImage, enterLinkPage as liveEnterLinkPage } from '../access/door.ts';
import { readLinkPage } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { updateMyMemberProfile } from '../members/profile.ts';
import { testScope, publishLinkPageForTest } from '../testing.ts';
import { profileAudioStorePath } from './audio.ts';
import { profileImageStorePath } from './images.ts';
import { addProfileImage, archiveProfileItem, readProfileItems, saveProfileItem } from './items.ts';

const { appUrl, ownerUrl, adminUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-link-bento-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A person with a handle and a workspace of theirs, as its owner. */
async function person(name: string) {
  count += 1;
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    name,
    `${userId}@example.com`,
  ]);
  const created = await createWorkspace(db, {
    name: 'Bento',
    slug: `bento-${String(count)}-${String(Date.now())}`,
    firstMember: { name, email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  const handle = `bento-${randomUUID().slice(0, 8)}`;
  await updateMyMemberProfile(scope, { handle });
  return { ...created, userId, scope, handle };
}

type Person = Awaited<ReturnType<typeof person>>;

async function refusalOf(promise: Promise<unknown>): Promise<{ code: string; message: string } | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return { code: error.refusal.code, message: error.refusal.message };
    throw error;
  }
}

const add = (who: Person, block: ProfileBlock, id = newId()) => saveProfileItem(who.scope, { id, block });

/** One of the person's pictures, kept as an upload would be (its bytes are never read here). */
async function picture(who: Person): Promise<string> {
  const id = newId();
  await addProfileImage(who.scope, {
    id,
    kind: 'upload',
    path: profileImageStorePath(who.userId, who.workspaceId, id, 'image/png'),
    type: 'image/png',
    bytes: 1200,
    width: 400,
    height: 300,
  });
  return id;
}

/** One of the person's recordings, kept as the audio upload keeps one. */
async function recording(who: Person): Promise<string> {
  const id = newId();
  await addProfileImage(who.scope, {
    id,
    kind: 'audio',
    path: profileAudioStorePath(who.userId, who.workspaceId, id, 'audio/mpeg'),
    type: 'audio/mpeg',
    bytes: 32_000,
    width: 1,
    height: 1,
  });
  return id;
}

const visitorRead = async (handle: string) => {
  await publishLinkPageForTest(adminUrl, handle);
  return readLinkPage(await liveEnterLinkPage({ db }, handle, { max: 21 }));
};

const WAVE = '0123456789abcdefghijklmnopqrstuv0123456789abcdef';

describe('bento cards', () => {
  it('saves each card, stores what it was given and nothing empty, and draws it for a visitor', async () => {
    const ada = await person('Ada');
    const logoA = await picture(ada);
    const logoB = await picture(ada);
    const shot = await picture(ada);
    const sound = await recording(ada);
    await add(ada, { kind: 'profile', line: 'Product designer in Lisbon', size: 'wide' });
    await add(ada, { kind: 'status', text: 'Available for work', state: 'open' });
    await add(ada, { kind: 'audio', audio: sound, title: 'Hi, I’m Ada', wave: WAVE });
    await add(ada, {
      kind: 'timeline',
      title: 'Experience',
      items: [
        { when: '2021', title: 'Designer', place: 'Webflow' },
        { when: '2019', title: 'Intern', place: '' },
      ],
    });
    await add(ada, {
      kind: 'logos',
      images: [
        { image: logoA, alt: 'Acme' },
        { image: logoB, alt: 'Globex' },
      ],
    });
    await add(ada, {
      kind: 'work',
      items: [{ image: shot, title: 'Effy', body: 'A social app with a twist.', url: 'effy.app' }, { title: 'Trade' }],
    });
    await add(ada, {
      kind: 'steps',
      title: 'How I work',
      items: [
        { title: 'Discovery call', body: 'Thirty minutes, free.' },
        { title: 'Plan', body: 'A written plan in a week.' },
      ],
    });
    await add(ada, { kind: 'location', title: 'Studio', address: '1 Rua Augusta, Lisbon' });
    await add(ada, {
      kind: 'events',
      items: [
        { title: 'Later', at: '2027-02-01T18:00:00.000Z' },
        { title: 'Sooner', at: '2027-01-01T18:00:00.000Z', place: 'Lisbon', url: 'https://a.co/e' },
      ],
    });
    // A span on a kind spec 0061 never sized.
    await add(ada, { kind: 'text', body: 'Hello there.', size: 'wide' });

    const stored = await readProfileItems(ada.scope);
    const timeline = stored.items.find((item) => item.kind === 'timeline');
    // The empty place was never stored.
    expect(timeline?.kind === 'timeline' && timeline.items[1]).toEqual({ when: '2019', title: 'Intern' });
    const status = stored.items.find((item) => item.kind === 'status');
    // `open` is the default, left out.
    expect(status?.kind === 'status' && status.state).toBeUndefined();

    const page = await visitorRead(ada.handle);
    const byKind = Object.fromEntries(page.items.map((item) => [item.kind, item]));
    expect(byKind.profile).toMatchObject({ line: 'Product designer in Lisbon', size: 'wide' });
    expect(byKind.status).toMatchObject({ text: 'Available for work', state: 'open' });
    expect(byKind.audio).toMatchObject({
      src: `/api/public/profiles/${ada.handle}/audio/${sound}`,
      title: 'Hi, I’m Ada',
      wave: WAVE,
    });
    expect(byKind.logos).toMatchObject({
      images: [
        { src: `/api/public/profiles/${ada.handle}/images/${logoA}`, alt: 'Acme', width: 400, height: 300 },
        { alt: 'Globex' },
      ],
    });
    expect(byKind.work).toMatchObject({
      items: [
        { title: 'Effy', url: 'https://effy.app', image: { src: `/api/public/profiles/${ada.handle}/images/${shot}` } },
        { title: 'Trade' },
      ],
    });
    expect(byKind.location).toMatchObject({
      address: '1 Rua Augusta, Lisbon',
      directions: 'https://www.google.com/maps/search/?api=1&query=1%20Rua%20Augusta%2C%20Lisbon',
    });
    // Soonest first.
    expect(byKind.events?.kind === 'events' && byKind.events.items.map((event) => event.title)).toEqual([
      'Sooner',
      'Later',
    ]);
    expect(byKind.text).toMatchObject({ size: 'wide' });
    // A visitor's answer names no picture id outside our own paths, and no workspace.
    expect(JSON.stringify(page)).not.toContain(ada.workspaceId);

    // The recording is served while the published block names it, and not once it is archived and published.
    const found = await liveEnterLinkImage({ db }, ada.handle, sound);
    expect(found.type).toBe('audio/mpeg');
    const audioBlock = stored.items.find((item) => item.kind === 'audio');
    if (audioBlock === undefined) throw new Error('no audio block');
    await archiveProfileItem(ada.scope, { id: audioBlock.id, archived: true });
    await publishLinkPageForTest(adminUrl, ada.handle);
    expect(await refusalOf(liveEnterLinkImage({ db }, ada.handle, sound))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a sound where a picture goes, a picture where the sound goes, and another person’s files', async () => {
    const ada = await person('Ada');
    const bo = await person('Bo');
    const sound = await recording(ada);
    const shot = await picture(ada);
    const theirs = await picture(bo);
    expect(await refusalOf(add(ada, { kind: 'audio', audio: shot }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(add(ada, { kind: 'image', image: sound, alt: 'A' }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await refusalOf(
        add(ada, {
          kind: 'logos',
          images: [
            { image: shot, alt: 'Mine' },
            { image: sound, alt: 'A sound' },
          ],
        }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(add(ada, { kind: 'work', items: [{ title: 'A', image: theirs }] }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await readProfileItems(ada.scope)).items).toEqual([]);
  });

  it('keeps each card to its cap, and refuses a span on a heading or a banner', async () => {
    const ada = await person('Ada');
    await add(ada, { kind: 'profile' });
    expect(await refusalOf(add(ada, { kind: 'profile' }))).toEqual({
      code: 'LIMIT_REACHED',
      message: 'A link page holds one profile card.',
    });
    await add(ada, { kind: 'location', address: 'One' });
    await add(ada, { kind: 'location', address: 'Two' });
    await add(ada, { kind: 'location', address: 'Three' });
    expect(await refusalOf(add(ada, { kind: 'location', address: 'Four' }))).toMatchObject({ code: 'LIMIT_REACHED' });
    // The schema has no span for these two, so the database is asked directly: it refuses too.
    await expect(
      testQuery(
        adminUrl,
        `select crm_check_profile_item('heading', '{"title":"A","size":"wide"}'::jsonb, null, null, null)`,
      ),
    ).rejects.toThrow();
    await expect(
      testQuery(
        adminUrl,
        `select crm_check_profile_item('banner', '{"text":"A","size":"wide"}'::jsonb, null, null, null)`,
      ),
    ).rejects.toThrow();
  });

  it('refuses a card whose fields the rule refuses, in core and in the database alike', async () => {
    const ada = await person('Ada');
    expect(await refusalOf(add(ada, { kind: 'steps', items: [{ title: 'Only', body: 'One step' }] }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    expect(
      await refusalOf(add(ada, { kind: 'work', items: [{ title: 'A', url: 'javascript:alert(1)' }] })),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(await refusalOf(add(ada, { kind: 'events', items: [{ title: 'A', at: 'tomorrow' }] }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    await expect(
      testQuery(
        adminUrl,
        `select crm_check_profile_item('status', '{"text":"Open","state":"busy"}'::jsonb, null, null, null)`,
      ),
    ).rejects.toThrow();
  });
});
