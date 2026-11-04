// The business page editor's store (spec 0066, B4 lite): two draft changes made in the same moment both keep, go out
// in the order they were made, and Publish goes out behind them, so it never publishes a draft without the last edit.
import type { BusinessPageContent, BusinessPageView } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { openBusinessPage, type BusinessPageProcedures } from './store.ts';

const VIEW: BusinessPageView = {
  handle: 'somewhere',
  draft: { gallery: [], amenities: [], hiddenPlaces: [] },
  hasChanges: false,
  changes: [],
  places: [],
  showsMenu: false,
  showsReserve: false,
};

/** An api that answers each call a tick later, recording what it was sent. */
function fakeApi() {
  const sent: { readonly kind: string; readonly draft?: BusinessPageContent }[] = [];
  let current = VIEW;
  const later = <T>(value: () => T) =>
    new Promise<T>((resolve) => {
      setTimeout(() => {
        resolve(value());
      }, 5);
    });
  const api: BusinessPageProcedures = {
    page: () => later(() => current),
    claimHandle: () => later(() => current),
    save: ({ draft }) => {
      sent.push({ kind: 'save', draft });
      return later(() => {
        current = { ...current, draft, hasChanges: true };
        return current;
      });
    },
    setPlaceSlug: () => later(() => current),
    publish: () => {
      sent.push({ kind: 'publish', draft: current.draft });
      return later(() => {
        current = { ...current, hasChanges: false, published: { at: '2026-11-04T10:00:00.000Z', version: 1 } };
        return current;
      });
    },
    discard: () => later(() => current),
  };
  return { api, sent };
}

describe('the business page store', () => {
  it('keeps two changes made at once, and publishes behind them', async () => {
    const { api, sent } = fakeApi();
    let id = 0;
    const store = openBusinessPage({
      api,
      call: (run) => run({}),
      mintId: () => `00000000-0000-7000-8000-${String((id += 1)).padStart(12, '0')}`,
      upload: () => Promise.reject(new Error('no uploads here')),
      origin: 'http://localhost',
    });
    store.held('ws').retain();
    // The first read lands.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.held('ws').getSnapshot().status).toBe('ready');
    const about = store.changeDraft('ws', (draft) => ({ ...draft, about: 'Late on weekends.' }));
    const wifi = store.changeDraft('ws', (draft) => ({ ...draft, amenities: [...draft.amenities, 'wifi'] }));
    const published = store.publish('ws');
    await expect(Promise.all([about, wifi, published])).resolves.toEqual([undefined, undefined, undefined]);
    expect(sent.map((each) => each.kind)).toEqual(['save', 'save', 'publish']);
    // The second change was made on top of the first, and Publish saw both.
    expect(sent[1]?.draft).toEqual({ gallery: [], amenities: ['wifi'], hiddenPlaces: [], about: 'Late on weekends.' });
    expect(sent[2]?.draft).toEqual(sent[1]?.draft);
  });
});
