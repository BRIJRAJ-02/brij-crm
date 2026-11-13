// Settings › Business › Page in Chromium (spec 0066, B4 lite), over the real editor store and a fake api that records
// what it is sent: an empty workspace's address starts as the business's name with a Claim to press; typed text saves
// without leaving the field, Publish sends it first and goes out behind it, and leaving the screen mid word keeps it;
// removing a photo offers Undo, which puts it back where it was; each photo row shows its picture; Discard asks in the
// danger tone.
import '@crm/ui/app.css';
import type { BusinessPageContent, BusinessPageView } from '@crm/data';
import { openBusinessPage, type BusinessPageProcedures } from '@crm/data/business-page/store';
import { createToasts, type ToastContent, type Toasts } from '@crm/ui';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { SettingsTopBarSlot } from '../settings/topBarSlot.ts';
import { BusinessPageScreen } from './BusinessPageScreen.tsx';

let shown: InApp | undefined;

const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;

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
        // Another business's address waits for its first Publish (spec 0065 H7): it stays `handleOnPublish`.
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

async function show(
  store: Awaited<ReturnType<typeof editorOf>>['store'],
  toasts: Toasts = createToasts(),
  width = 1280,
) {
  await page.viewport(width, 900);
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

  it('saves another business’s address for its first Publish, saying it is not held yet (spec 0065 H7)', async () => {
    const { store, calls } = await editorOf({ ...BASE, suggestedHandle: 'harbour-bar', handleOnPublish: true });
    const { toasts, said } = recordingToasts();
    await show(store, toasts);
    await expect
      .element(page.getByText('We started it from your business’s name. Save it, or change it first.'))
      .toBeVisible();
    // Nothing is held yet, so there is no Claim and nothing to copy.
    await expect.element(page.getByRole('button', { name: 'Claim' })).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'Save' }));
    await expect.poll(() => calls.map((call) => call.handle)).toEqual(['harbour-bar']);
    await expect.poll(() => said.map((content) => content.message)).toContain('Address saved.');
    await expect.element(page.getByText('Until then, someone else could take this address.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Copy address' })).not.toBeInTheDocument();
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
    // Each photo drawn from a picture the test holds: in CI nothing answers /api, and Avatar falls back to its initials
    // on a picture that fails, so the thumbnail would never be an <img> there.
    const drawn = (photoId: string) =>
      `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" id="p${photoId}"><rect width="8" height="8" fill="#c9704f"/></svg>`)}`;
    await show({ ...store, photoSrc: (_slug: string, photoId: string) => drawn(photoId) }, toasts);
    await expect.element(page.getByRole('textbox', { name: 'Photo 3 description' })).toBeInTheDocument();
    // Every row has both arrows, the end ones disabled, so the rows line up.
    await expect.element(page.getByRole('button', { name: 'Move photo 1 earlier' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Move photo 3 later' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Move photo 2 later' })).toBeEnabled();
    // A thumbnail in each photo's row.
    await expect
      .poll(() => document.querySelectorAll(`img[src*="${encodeURIComponent(`id="p${PHOTO(2).id}"`)}"]`).length)
      .toBeGreaterThan(0);
    await userEvent.click(page.getByRole('button', { name: 'Remove photo 2' }));
    await expect.poll(() => calls.at(-1)?.draft?.gallery.map((photo) => photo.id)).toEqual([PHOTO(1).id, PHOTO(3).id]);
    const removed = said.find((content) => content.message === 'Photo removed.');
    expect(removed?.action?.label).toBe('Undo');
    removed?.action?.onAction();
    await expect
      .poll(() => calls.at(-1)?.draft?.gallery.map((photo) => photo.id))
      .toEqual([PHOTO(1).id, PHOTO(2).id, PHOTO(3).id]);
  });

  it('keeps a cover apart from the gallery, with Change, Adjust and Remove with Undo, in both themes (AC-6513)', async () => {
    const drawn = (photoId: string) =>
      `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9" id="p${photoId}"><rect width="16" height="9" fill="#${photoId.endsWith('9') ? '3d6b8f' : 'c9704f'}"/></svg>`)}`;
    const cover = { id: '01900000-0000-7000-8000-000000000009', width: 1200, height: 630 };
    const withCover: BusinessPageView = {
      ...BASE,
      handle: 'somewhere',
      draft: { ...BASE.draft, cover, gallery: [PHOTO(1), PHOTO(2)] },
    };
    for (const width of [1280, 390]) {
      for (const theme of THEMES) {
        const { store } = await editorOf(withCover);
        await show({ ...store, photoSrc: (_slug: string, photoId: string) => drawn(photoId) }, createToasts(), width);
        applyTheme(theme);
        await expect.element(page.getByRole('button', { name: 'Change cover photo' })).toBeVisible();
        await expect.element(page.getByRole('button', { name: 'Remove cover photo' })).toBeVisible();
        // With a cover, no gallery photo says it leads the page.
        await expect.element(page.getByText('Leads the page', { exact: true })).not.toBeInTheDocument();
        expect(await axeViolations()).toEqual([]);
        if (SHOT_DIR !== undefined && SHOT_DIR !== '') {
          await page.screenshot({ path: `${SHOT_DIR}/cover-${theme}-${String(width)}.png`, fullPage: true } as never);
        }
        shown?.unmount();
        shown = undefined;
        resetTheme();
      }
    }
    // Remove takes it off the draft at once, and Undo puts it back.
    const { store, calls } = await editorOf(withCover);
    const { toasts, said } = recordingToasts();
    await show({ ...store, photoSrc: (_slug: string, photoId: string) => drawn(photoId) }, toasts);
    // Its description is typed beside it and saved on the cover, as each photo's is.
    await userEvent.fill(page.getByRole('textbox', { name: 'Cover photo description' }), 'The terrace');
    await expect.poll(() => calls.at(-1)?.draft?.cover?.alt).toBe('The terrace');
    await userEvent.click(page.getByRole('button', { name: 'Remove cover photo' }));
    await expect.poll(() => calls.at(-1)?.draft?.cover).toBeUndefined();
    expect(calls.at(-1)?.kind).toBe('save');
    // The remove button goes with the picture: focus lands on Upload, not the page.
    await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Upload cover photo');
    const removed = said.find((content) => content.message === 'Cover photo removed.');
    expect(removed?.action?.label).toBe('Undo');
    removed?.action?.onAction();
    await expect.poll(() => calls.at(-1)?.draft?.cover?.alt).toBe('The terrace');
    // Without a cover, the first photo leads, as before, and the row offers an upload.
    shown?.unmount();
    shown = undefined;
    const { store: bare } = await editorOf({ ...withCover, draft: { ...BASE.draft, gallery: [PHOTO(1)] } });
    await show({ ...bare, photoSrc: (_slug: string, photoId: string) => drawn(photoId) });
    await expect.element(page.getByText('Leads the page', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Upload cover photo' })).toBeVisible();
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
    // The publish bar heads the editor (spec 0074, AC-7407): its Discard draft asks first, the action on its danger
    // button (AC-7408).
    await userEvent.click(page.getByRole('button', { name: 'Discard draft' }));
    const dialog = page.getByRole('alertdialog');
    await expect
      .element(dialog.getByRole('button', { name: 'Discard draft' }))
      .toHaveAttribute('data-variant', 'danger-solid');
  });

  it('keeps Publish in view on a phone, with Discard draft beside it', async () => {
    const { store } = await editorOf({
      ...BASE,
      handle: 'somewhere',
      hasChanges: true,
      changes: ['About changed'],
      published: { at: '2026-11-03T10:00:00.000Z', version: 1 },
    });
    await show(store, createToasts(), 390);
    const publish = page.getByRole('button', { name: 'Publish' });
    await expect.element(publish).toBeVisible();
    const box = publish.element().getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(390);
    await expect.element(page.getByRole('button', { name: 'Discard draft' })).toBeVisible();
  });

  it('shares a published page in the one share sheet (spec 0074, AC-7406)', async () => {
    const { store } = await editorOf({
      ...BASE,
      handle: 'somewhere',
      published: { at: '2026-11-03T10:00:00.000Z', version: 1 },
    });
    await show(store);
    await userEvent.click(page.getByRole('button', { name: 'Share' }));
    const sheet = page.getByRole('dialog', { name: 'Share your business page' });
    await expect.element(sheet.getByRole('img', { name: 'QR code for @somewhere' })).toBeInTheDocument();
    await expect
      .element(sheet.getByRole('link', { name: 'View page' }))
      .toHaveAttribute('href', expect.stringContaining('/somewhere'));
  });

  it('offers no Share before the page is published', async () => {
    const { store } = await editorOf({ ...BASE, handle: 'somewhere' });
    await show(store);
    await expect.element(page.getByRole('button', { name: 'Publish' })).toBeVisible();
    expect(page.getByRole('button', { name: 'Share' }).query()).toBeNull();
  });

  it('leads to Brand for the logo and colours', async () => {
    const { store } = await editorOf({ ...BASE, handle: 'somewhere' });
    await show(store);
    await expect
      .element(page.getByRole('link', { name: 'Open Brand' }))
      .toHaveAttribute('href', '/w/acme/settings/brand');
  });

  it('reads cleanly for another business before its first Publish, in both themes (spec 0065 H7)', async () => {
    const second = {
      ...BASE,
      handle: 'harbour-bar',
      handleOnPublish: true as const,
      hasChanges: true,
      places: [
        {
          id: '01900000-0000-7000-8000-0000000000a1',
          name: 'Harbour',
          slug: 'harbour',
          hasAddress: true,
          hasHours: true,
        },
        { id: '01900000-0000-7000-8000-0000000000a2', name: 'Pier', slug: 'pier', hasAddress: true, hasHours: true },
      ],
    };
    for (const width of [1280, 390]) {
      for (const theme of THEMES) {
        const { store } = await editorOf(second);
        await show(store, createToasts(), width);
        applyTheme(theme);
        await expect.element(page.getByText('Until then, someone else could take this address.')).toBeVisible();
        expect(await axeViolations()).toEqual([]);
        if (SHOT_DIR !== undefined && SHOT_DIR !== '') {
          await page.screenshot({
            path: `${SHOT_DIR}/settings-page-${theme}-${String(width)}.png`,
            fullPage: true,
          } as never);
        }
        shown?.unmount();
        shown = undefined;
        resetTheme();
      }
    }
  });
});
