// Settings › Business › Page in Chromium (spec 0066, B4 lite), over the real editor store and a fake api that records
// what it is sent: an empty workspace's address starts as the business's name with a Claim to press; typed text saves
// without leaving the field, Publish sends it first and goes out behind it, and leaving the screen mid word keeps it;
// removing a photo offers Undo, which puts it back where it was; each photo row shows its picture; Discard asks in the
// danger tone.
import '@crm/ui/styles.css';
import type { BusinessPageContent, BusinessPageView } from '@crm/data';
import { openBusinessPage, type BusinessPageProcedures } from '@crm/data/business-page/store';
import { createToasts, type ToastContent, type Toasts } from '@crm/ui';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { SettingsTopBarSlot } from '../settings/topBarSlot.ts';
import { BusinessPageScreen } from './BusinessPageScreen.tsx';

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

const PHOTO = (n: number) => ({ id: `01900000-0000-7000-8000-00000000000${String(n)}`, width: 1600, height: 1200 });

const BASE: BusinessPageView = {
  draft: { gallery: [], amenities: [], hiddenPlaces: [] },
  hasChanges: false,
  changes: [],
  places: [{ id: '01900000-0000-7000-8000-0000000000aa', name: 'Indiranagar', hasAddress: true, hasHours: true }],
  showsMenu: false,
  showsReserve: true,
};

/** An api answering a moment later, as the network does, recording each call. */
function fakeApi(first: BusinessPageView) {
  const calls: { readonly kind: string; readonly draft?: BusinessPageContent; readonly handle?: string }[] = [];
  let current = first;
  const later = <T,>(value: () => T) =>
    new Promise<T>((resolve) => {
      setTimeout(() => {
        resolve(value());
      }, 20);
    });
  const api: BusinessPageProcedures = {
    page: () => later(() => current),
    claimHandle: ({ handle }) => {
      calls.push({ kind: 'claim', handle });
      return later(() => {
        const { suggestedHandle: _suggested, ...rest } = current;
        current = { ...rest, handle };
        return current;
      });
    },
    save: ({ draft }) => {
      calls.push({ kind: 'save', draft });
      return later(() => {
        current = { ...current, draft, hasChanges: true };
        return current;
      });
    },
    setPlaceSlug: () => later(() => current),
    publish: () => {
      calls.push({ kind: 'publish', draft: current.draft });
      return later(() => {
        current = { ...current, hasChanges: false, published: { at: '2026-11-04T10:00:00.000Z', version: 1 } };
        return current;
      });
    },
    discard: () => later(() => current),
  };
  return { api, calls };
}

/** The real store over the fake api, its first read landed. */
async function editorOf(first: BusinessPageView) {
  const { api, calls } = fakeApi(first);
  let id = 0;
  const store = openBusinessPage({
    api,
    call: (run) => run({}),
    mintId: () => `01900001-0000-7000-8000-${String((id += 1)).padStart(12, '0')}`,
    upload: () => Promise.reject(new Error('No uploads here.')),
    origin: globalThis.location.origin,
  });
  store.held('acme').retain();
  await expect.poll(() => store.held('acme').getSnapshot().status).toBe('ready');
  return { store, calls };
}

/** The app's toasts, keeping what each said so a test can press its action. */
function recordingToasts() {
  const real = createToasts();
  const said: ToastContent[] = [];
  const toasts: Toasts = {
    ...real,
    toast: (content, options) => {
      said.push(content);
      return real.toast(content, options);
    },
  };
  return { toasts, said };
}

async function show(store: Awaited<ReturnType<typeof editorOf>>['store'], toasts: Toasts = createToasts()) {
  await page.viewport(1280, 900);
  // The settings frame's bar slot, so the page's TopBar (Publish, Discard) draws as it does in the app.
  const bar = document.createElement('div');
  document.body.prepend(bar);
  shown = await renderInApp(
    () => (
      <SettingsTopBarSlot value={bar}>
        <BusinessPageScreen store={store} slug="acme" toasts={toasts} />
      </SettingsTopBarSlot>
    ),
    {
      data: {},
      pattern: '/w/$slug/settings/business/page',
      at: '/w/acme/settings/business/page',
      toasts,
    },
  );
  const unmount = shown.unmount;
  shown = {
    ...shown,
    unmount: () => {
      unmount();
      bar.remove();
    },
  };
}

describe('Settings › Business › Page', () => {
  it('starts an empty workspace’s address from the business’s name, and Claim leaves once it is claimed', async () => {
    const { store, calls } = await editorOf({ ...BASE, suggestedHandle: 'somewhere-nowhere' });
    await show(store);
    await expect.element(page.getByRole('textbox', { name: 'Page address' })).toHaveValue('somewhere-nowhere');
    // The note says where the address came from, not to pick one the field already holds.
    await expect
      .element(page.getByText('We started it from your business’s name. Claim it, or change it first.'))
      .toBeVisible();
    const claim = page.getByRole('button', { name: 'Claim' });
    await expect.element(claim).toHaveAttribute('data-variant', 'secondary');
    await userEvent.click(claim);
    await expect.poll(() => calls.map((call) => call.handle)).toEqual(['somewhere-nowhere']);
    await expect.element(page.getByRole('button', { name: 'Claim' })).not.toBeInTheDocument();
  });

  it('saves typed About without leaving the field, and Publish publishes the last keystroke', async () => {
    const { store, calls } = await editorOf({ ...BASE, handle: 'somewhere' });
    await show(store);
    const about = page.getByRole('textbox', { name: 'About text' });
    // A pause after a space: the draft saves "Late", and the field keeps the space the next word needs.
    await userEvent.type(about, 'Late ');
    await expect.poll(() => calls.filter((call) => call.kind === 'save').at(-1)?.draft?.about).toBe('Late');
    await userEvent.type(about, 'on weekends.');
    // A moment after the typing stops, the draft saves on its own.
    await expect
      .poll(() => calls.filter((call) => call.kind === 'save').at(-1)?.draft?.about)
      .toBe('Late on weekends.');
    // Typing again and pressing Publish at once: the text goes out first, and Publish publishes it.
    await userEvent.type(about, ' Cocktails.');
    await userEvent.click(page.getByRole('button', { name: 'Publish' }));
    await expect.poll(() => calls.at(-1)?.kind).toBe('publish');
    expect(calls.at(-1)?.draft?.about).toBe('Late on weekends. Cocktails.');
  });

  it('keeps text typed when the screen goes before the save', async () => {
    const { store, calls } = await editorOf({ ...BASE, handle: 'somewhere' });
    await show(store);
    await userEvent.type(page.getByRole('textbox', { name: 'About text' }), 'Plates to share');
    shown?.unmount();
    shown = undefined;
    await expect.poll(() => calls.at(-1)?.draft?.about).toBe('Plates to share');
  });

  it('shows each photo beside its description, and Undo puts a removed photo back where it was', async () => {
    const { store, calls } = await editorOf({
      ...BASE,
      handle: 'somewhere',
      draft: { ...BASE.draft, gallery: [PHOTO(1), PHOTO(2), PHOTO(3)] },
    });
    const { toasts, said } = recordingToasts();
    await show(store, toasts);
    await expect.element(page.getByRole('textbox', { name: 'Photo 3 description' })).toBeInTheDocument();
    // Every row has both arrows, the end ones disabled, so the rows line up.
    await expect.element(page.getByRole('button', { name: 'Move photo 1 earlier' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Move photo 3 later' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Move photo 2 later' })).toBeEnabled();
    // A thumbnail in each photo's row.
    expect(document.querySelectorAll(`img[src*="/api/business/page/photos/${PHOTO(2).id}"]`).length).toBeGreaterThan(0);
    await userEvent.click(page.getByRole('button', { name: 'Remove photo 2' }));
    await expect.poll(() => calls.at(-1)?.draft?.gallery.map((photo) => photo.id)).toEqual([PHOTO(1).id, PHOTO(3).id]);
    const removed = said.find((content) => content.message === 'Photo removed.');
    expect(removed?.action?.label).toBe('Undo');
    removed?.action?.onAction();
    await expect
      .poll(() => calls.at(-1)?.draft?.gallery.map((photo) => photo.id))
      .toEqual([PHOTO(1).id, PHOTO(2).id, PHOTO(3).id]);
  });

  it('asks before discarding, in the danger tone', async () => {
    const { store } = await editorOf({
      ...BASE,
      handle: 'somewhere',
      hasChanges: true,
      changes: ['About changed'],
      published: { at: '2026-11-03T10:00:00.000Z', version: 1 },
    });
    await show(store);
    await userEvent.click(page.getByRole('button', { name: 'Discard changes' }));
    const dialog = page.getByRole('dialog');
    await expect
      .element(dialog.getByRole('button', { name: 'Discard changes' }))
      .toHaveAttribute('data-variant', 'danger-solid');
  });

  it('leads to Brand for the logo and colours', async () => {
    const { store } = await editorOf({ ...BASE, handle: 'somewhere' });
    await show(store);
    await expect
      .element(page.getByRole('link', { name: 'Open Brand' }))
      .toHaveAttribute('href', '/w/acme/settings/brand');
  });
});
