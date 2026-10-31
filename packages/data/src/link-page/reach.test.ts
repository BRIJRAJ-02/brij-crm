// Spec 0061's side of the link page store (R4): the six new kinds and the fields every block gained, checked as the
// server will before anything is sent, and Insights and the share QR's style held as screens read them.
import type { ProfileCounts, ProfileItem, ProfileQrStyle } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError } from '../errors.ts';
import {
  bannerIsFull,
  checkReachBlock,
  createReach,
  mediaProviderOf,
  qrColourProblem,
  windowStateOf,
} from './reach.ts';
import { checkBlock } from './store.ts';

const PICTURE = '0192f0c8-7d2a-7000-8000-000000000001';
const OTHER = '0192f0c8-7d2a-7000-8000-000000000002';

const link = (id: string, style?: 'featured'): ProfileItem => ({
  kind: 'link',
  id,
  title: id,
  url: `https://${id}.dev`,
  hue: 'blue',
  ...(style === undefined ? {} : { style }),
  updatedAt: '2026-10-31T00:00:00.000Z',
});

describe('spec 0061’s kinds, checked before anything is sent', () => {
  it('takes a video or song from the five services only, by the address’s host', () => {
    expect(mediaProviderOf('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
    expect(mediaProviderOf('open.spotify.com/track/abc')).toBe('spotify');
    expect(mediaProviderOf('https://youtube.com.evil.dev/watch?v=x')).toBeUndefined();
    expect(checkReachBlock({ kind: 'media', url: 'https://example.com/a' })).toEqual({
      ok: false,
      problems: { url: 'Paste a link from YouTube, Vimeo, Spotify, SoundCloud or Apple Music.' },
    });
    expect(checkReachBlock({ kind: 'media', url: ' https://vimeo.com/1 ', title: ' Talk ', size: 'wide' })).toEqual({
      ok: true,
      block: { kind: 'media', url: 'https://vimeo.com/1', title: 'Talk', size: 'wide' },
    });
  });

  it('asks a picture for its description, and a gallery for two to twelve described pictures', () => {
    expect(checkReachBlock({ kind: 'image', alt: ' ' })).toMatchObject({
      ok: false,
      problems: { image: 'Add a picture.', alt: 'Describe the picture for people who can’t see it.' },
    });
    expect(checkReachBlock({ kind: 'image', image: PICTURE, alt: 'A cat', caption: '', url: 'ada.dev' })).toEqual({
      ok: true,
      block: { kind: 'image', image: PICTURE, alt: 'A cat', url: 'https://ada.dev' },
    });
    expect(checkReachBlock({ kind: 'gallery', images: [{ image: PICTURE, alt: 'One' }] })).toMatchObject({
      ok: false,
      problems: { images: 'Add at least two pictures.' },
    });
    expect(
      checkReachBlock({
        kind: 'gallery',
        images: [
          { image: PICTURE, alt: 'One' },
          { image: OTHER, alt: '' },
        ],
      }),
    ).toMatchObject({ ok: false, problems: { 'alt:1': 'Describe the picture for people who can’t see it.' } });
  });

  it('keeps a banner to one line of 80, a next times block to a page, and sends a small tile as no size', () => {
    expect(checkReachBlock({ kind: 'banner', text: 'x'.repeat(81) })).toMatchObject({
      ok: false,
      problems: { text: 'Keep the banner to 80 characters.' },
    });
    expect(checkReachBlock({ kind: 'times' })).toMatchObject({ ok: false, problems: { page: 'Pick a booking page.' } });
    expect(checkReachBlock({ kind: 'image', image: PICTURE, alt: 'A', size: 'small' })).toEqual({
      ok: true,
      block: { kind: 'image', image: PICTURE, alt: 'A' },
    });
  });
});

describe('the fields every block gained', () => {
  it('refuses a window whose end comes before its start (AC-6111), and sends both ends in one spelling', () => {
    const refused = checkBlock(
      { kind: 'text', body: 'Hi', showFrom: '2026-11-10T09:00:00Z', hideAfter: '2026-11-03T09:00:00Z' },
      [],
    );
    expect(refused).toEqual({ ok: false, problems: { hideAfter: '“Hide after” has to come after “Show from”.' } });
    expect(checkBlock({ kind: 'text', body: 'Hi', showFrom: '2026-11-03T09:00Z' }, [])).toEqual({
      ok: true,
      block: { kind: 'text', body: 'Hi', showFrom: '2026-11-03T09:00:00.000Z' },
    });
  });

  it('gives a link its picture, card and notice, and a fourth featured link is refused (AC-6102)', () => {
    const draft = {
      kind: 'link' as const,
      title: 'Shop',
      url: 'shop.dev',
      note: '',
      thumb: PICTURE,
      style: 'featured' as const,
      notice: '18' as const,
      size: 'large' as const,
    };
    expect(checkBlock(draft, [link('a', 'featured'), link('b', 'featured')])).toEqual({
      ok: true,
      block: {
        kind: 'link',
        title: 'Shop',
        url: 'https://shop.dev',
        thumb: PICTURE,
        style: 'featured',
        notice: '18',
        size: 'large',
      },
    });
    const three = [link('a', 'featured'), link('b', 'featured'), link('c', 'featured')];
    expect(checkBlock(draft, three)).toMatchObject({
      ok: false,
      problems: { style: 'A link page holds up to 3 featured links.' },
    });
    // The link being edited is not counted against itself.
    expect(checkBlock(draft, three, 'c')).toMatchObject({ ok: true });
  });

  it('never gives a heading a window, nor a kind that spans the row a size', () => {
    expect(checkBlock({ kind: 'heading', title: 'Work' }, [])).toEqual({
      ok: true,
      block: { kind: 'heading', title: 'Work' },
    });
    expect(checkBlock({ kind: 'text', body: 'Hi', size: 'large' } as never, [])).toEqual({
      ok: true,
      block: { kind: 'text', body: 'Hi' },
    });
  });

  it('reads where a window stands for its chip, and a banner past its end frees the place', () => {
    const now = new Date('2026-11-05T00:00:00Z');
    const banner = (hideAfter?: string): ProfileItem => ({
      kind: 'banner',
      id: 'b',
      text: 'Sale',
      ...(hideAfter === undefined ? {} : { hideAfter }),
      updatedAt: '',
    });
    expect(windowStateOf(banner('2026-11-10T00:00:00.000Z'), now)).toEqual({
      state: 'ends',
      at: '2026-11-10T00:00:00.000Z',
    });
    expect(windowStateOf(banner('2026-11-01T00:00:00.000Z'), now).state).toBe('ended');
    expect(bannerIsFull([banner('2026-11-01T00:00:00.000Z')], now)).toBe(false);
    expect(bannerIsFull([banner()], now)).toBe(true);
  });

  it('refuses a QR colour too light to scan against white (AC-6124)', () => {
    expect(qrColourProblem('#1f2937')).toBeUndefined();
    expect(qrColourProblem('#ffd400')).toBe('Pick a darker colour, so every phone can read the code.');
  });
});

/** A promise and its resolve and reject, for answering a call by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const COUNTS: ProfileCounts = { days: 7, views: 3, visitors: 2, before: { views: 0, visitors: 0 }, presses: [] };

describe('Insights and the code’s style, as screens hold them', () => {
  it('reads a period when first held, keeps it a minute, and says when a first read failed', async () => {
    let clock = 0;
    const asked: number[] = [];
    let answer = deferred<ProfileCounts>();
    const reach = createReach({
      api: {
        counts: (input) => {
          asked.push(input.days);
          return answer.promise;
        },
        fetchThumbnail: () => Promise.reject(new Error('unused')),
        qrStyle: () => Promise.resolve({}),
        saveQrStyle: () => Promise.resolve({}),
        upload: () => Promise.reject(new Error('unused')),
      },
      mintId: () => 'm',
      now: () => clock,
    });
    const week = reach.insights('acme', 7);
    week.retain();
    expect(week.getSnapshot()).toEqual({ status: 'loading' });
    answer.resolve(COUNTS);
    await answer.promise;
    await Promise.resolve();
    expect(week.getSnapshot()).toEqual({ status: 'ready', counts: COUNTS });
    clock = 30_000;
    week.retain();
    expect(asked).toEqual([7]);
    answer = deferred<ProfileCounts>();
    const quarter = reach.insights('acme', 90);
    quarter.retain();
    answer.reject(dataError('INTERNAL', 'Something went wrong.'));
    await answer.promise.catch(() => undefined);
    await Promise.resolve();
    expect(quarter.getSnapshot()).toMatchObject({ status: 'error' });
    expect(asked).toEqual([7, 90]);
  });

  it('shows a new style at once, and puts the saved one back when it is refused', async () => {
    const saved: ProfileQrStyle = { colour: '#1f2937' };
    const save = deferred<ProfileQrStyle>();
    const reach = createReach({
      api: {
        counts: () => Promise.resolve(COUNTS),
        fetchThumbnail: () => Promise.reject(new Error('unused')),
        qrStyle: () => Promise.resolve(saved),
        saveQrStyle: () => save.promise,
        upload: () => Promise.reject(new Error('unused')),
      },
      mintId: () => 'm',
    });
    const held = reach.qrStyle('acme');
    held.retain();
    await Promise.resolve();
    await Promise.resolve();
    expect(held.getSnapshot()).toEqual({ status: 'ready', style: saved, isSaving: false });
    const refused = reach.saveQrStyle('acme', { colour: '#000000', label: 'Scan me' });
    expect(held.getSnapshot()).toEqual({
      status: 'ready',
      style: { colour: '#000000', label: 'Scan me' },
      isSaving: true,
    });
    save.reject(dataError('CONFIG_INVALID', 'Pick a darker colour, so every phone can read the code.'));
    await expect(refused).resolves.toMatchObject({ code: 'CONFIG_INVALID' });
    expect(held.getSnapshot()).toEqual({ status: 'ready', style: saved, isSaving: false });
  });
});
