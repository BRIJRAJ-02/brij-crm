// "Show my photo on booking pages" in Chromium (owner ask A124): every state of the row (loading, on, off, saving,
// a failed read with Try again, read only), a change shown at once and confirmed in a quiet toast with Undo, a
// refused one put back with no confirmation, and the switch by keyboard.
import type { DataLayer, PictureChoiceHeld, PictureChoiceState } from '@crm/data';
import { createToasts, UiProvider, type Toasts } from '@crm/ui';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { PhotoSwitch } from './PhotoSwitch.tsx';

const TITLE = 'Show my photo on booking pages';
const HINT = 'Your Google photo. When off, your booking pages and profile show your initials.';
const SHOWN: PictureChoiceState = { status: 'ready', isHidden: false, isSaving: false, canChange: true };

beforeAll(async () => {
  await page.viewport(1280, 800);
});

let mounted: { readonly root: Root; readonly host: HTMLElement } | undefined;

afterEach(() => {
  if (mounted === undefined) return;
  const { root, host } = mounted;
  act(() => {
    root.unmount();
  });
  host.remove();
  mounted = undefined;
});

/**
 * A picture choice the test drives, as the data layer holds it: a change shows at once and saves until the test
 * answers it, landing or put back.
 */
function fakeChoice(initial: PictureChoiceState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const set = (next: PictureChoiceState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const sent: { readonly isHidden: boolean; readonly answer: (landed: boolean) => void }[] = [];
  let retries = 0;
  const held: PictureChoiceHeld = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain: () => () => undefined,
    retry: () => {
      retries += 1;
    },
  };
  const setPictureHidden = (_workspace: string, isHidden: boolean): Promise<boolean> => {
    if (state.status !== 'ready' || !state.canChange) return Promise.resolve(false);
    const before = state;
    set({ ...before, isHidden, isSaving: true });
    return new Promise<boolean>((resolve) => {
      sent.push({
        isHidden,
        answer: (landed) => {
          act(() => {
            set({ ...before, isHidden: landed ? isHidden : before.isHidden, isSaving: false });
          });
          resolve(landed);
        },
      });
    });
  };
  const layer = { profile: { picture: () => held, setPictureHidden } } as unknown as DataLayer;
  return { layer, sent, set, retries: () => retries };
}

async function render(layer: DataLayer, hasPhoto = true): Promise<Toasts> {
  const toasts = createToasts();
  const rootRoute = createRootRouteWithContext<{ data: DataLayer; toasts: Toasts }>()();
  const profile = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$slug/settings/account/profile',
    component: () => <PhotoSwitch data={layer} slug="acme" hasPhoto={hasPhoto} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([profile]),
    history: createMemoryHistory({ initialEntries: ['/w/acme/settings/account/profile'] }),
    context: { data: layer, toasts },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => {
    root.render(
      <UiProvider
        locale="en-GB"
        timeZone="UTC"
        toasts={toasts}
        navigate={(href) => {
          router.history.push(href);
        }}
        useHref={(href) => router.history.createHref(href)}
      >
        <RouterProvider router={router} />
      </UiProvider>,
    );
    await router.load();
  });
  return toasts;
}

const theSwitch = () => page.getByRole('switch', { name: TITLE });

/**
 * Turns the switch as a keyboard does: focus, then Space. The tests load no library CSS, so its track has no size a
 * pointer could press (the Switch's own stories prove the press and its hit area).
 */
async function pressSwitch() {
  const control = theSwitch().element();
  if (!(control instanceof HTMLElement)) throw new Error('The switch is no element.');
  act(() => {
    control.focus();
  });
  await userEvent.keyboard(' ');
}

describe('Show my photo on booking pages', () => {
  it('starts on, saying it is the Google photo and what off does', async () => {
    const { layer } = fakeChoice(SHOWN);
    await render(layer);
    await expect.element(theSwitch()).toBeChecked();
    await expect.element(page.getByText(HINT)).toBeVisible();
  });

  it('turns off at once, confirms in a quiet toast once it lands, and Undo turns it back on', async () => {
    const { layer, sent } = fakeChoice(SHOWN);
    await render(layer);
    await pressSwitch();
    await expect.element(theSwitch()).not.toBeChecked();
    expect(sent.map((each) => each.isHidden)).toEqual([true]);
    sent[0]?.answer(true);
    await expect.element(page.getByText('Photo hidden on booking pages')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.element(theSwitch()).toBeChecked();
    expect(sent.map((each) => each.isHidden)).toEqual([true, false]);
    sent[1]?.answer(true);
    await expect.element(page.getByText('Change undone')).toBeVisible();
    // One toast at a time: the change's own went when Undo's came.
    await expect.element(page.getByText('Photo hidden on booking pages')).not.toBeInTheDocument();
  });

  it('is put back when refused, with no confirmation', async () => {
    const { layer, sent } = fakeChoice(SHOWN);
    await render(layer);
    await pressSwitch();
    await expect.element(theSwitch()).not.toBeChecked();
    sent[0]?.answer(false);
    await expect.element(theSwitch()).toBeChecked();
    await expect.element(page.getByText('Photo hidden on booking pages')).not.toBeInTheDocument();
  });

  it('shows a spinner beside the title only while a slow save is on its way', async () => {
    const { layer, sent } = fakeChoice(SHOWN);
    await render(layer);
    await pressSwitch();
    await expect.element(page.getByRole('progressbar', { name: 'Saving' })).toBeVisible();
    sent[0]?.answer(true);
    await expect.element(page.getByRole('progressbar', { name: 'Saving' })).not.toBeInTheDocument();
    await expect.element(theSwitch()).not.toBeChecked();
  });

  it('turns by keyboard: Tab reaches it, Space turns it', async () => {
    const { layer, sent } = fakeChoice({ ...SHOWN, isHidden: true });
    await render(layer);
    await expect.element(theSwitch()).not.toBeChecked();
    await userEvent.keyboard('{Tab}');
    await expect.element(theSwitch()).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect.element(theSwitch()).toBeChecked();
    expect(sent.map((each) => each.isHidden)).toEqual([false]);
    sent[0]?.answer(true);
    await expect.element(page.getByText('Photo shown on booking pages')).toBeVisible();
  });

  it('holds its place while loading, then says a failed read with Try again', async () => {
    const { layer, set, retries } = fakeChoice({ status: 'loading' });
    await render(layer);
    await expect.element(page.getByText(TITLE)).toBeVisible();
    await expect.element(theSwitch()).not.toBeInTheDocument();
    act(() => {
      set({ status: 'error', message: 'Can’t reach Timefix. Check your connection, then try again.' });
    });
    await expect.element(page.getByText('Can’t reach Timefix. Check your connection, then try again.')).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    expect(retries()).toBe(1);
    act(() => {
      set(SHOWN);
    });
    await expect.element(theSwitch()).toBeChecked();
  });

  it('says the pages show initials while the account has no photo, and still saves the choice', async () => {
    const { layer, sent } = fakeChoice(SHOWN);
    await render(layer, false);
    await expect.element(page.getByText('You have no photo yet, so your pages show your initials.')).toBeVisible();
    await pressSwitch();
    expect(sent.map((each) => each.isHidden)).toEqual([true]);
  });

  it('is read only for a member with no sign in of their own', async () => {
    const { layer, sent } = fakeChoice({ ...SHOWN, canChange: false });
    await render(layer);
    await expect.element(page.getByText('Only a person who signs in has a photo to show.')).toBeVisible();
    await expect.element(theSwitch()).toHaveAttribute('aria-readonly', 'true');
    await pressSwitch();
    await expect.element(theSwitch()).toBeChecked();
    expect(sent).toEqual([]);
  });
});
