// The note window's delete in Chromium (spec 0019, AC-445, and the owner's
// rule of 21 October 2026): a note can't come back from the Trash, so "Delete
// note" asks first. Cancel (or Esc) changes nothing and leaves the window
// open; Delete note runs the delete once, closes the window and offers Undo;
// a refused delete stays in the confirm with its reason. The editor's chunk
// is stubbed: its own behaviour is the library's stories'.
import { dataError, type DataError, type DataLayer, type NoteSession, type NoteSessionState } from '@crm/data';
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
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { NoteWindow } from './NoteWindow.tsx';

vi.mock('./editor.ts', () => ({
  NoteEditor: () => <p>The note’s page</p>,
  preloadNoteEditor: () => undefined,
}));

const NOTE = '0199a6f2-0000-7000-8000-0000000000a1';
const RECORD = {
  objectId: 'people',
  recordId: '0199a6f2-0000-7000-8000-0000000000b1',
  name: 'Brijraj',
  kind: 'person' as const,
};

/** A stored note, ready, that the reader may change. */
const READY: NoteSessionState = {
  status: 'ready',
  noteId: NOTE,
  recordId: RECORD.recordId,
  isNew: false,
  title: 'Kickoff call',
  docKey: 0,
  canChange: true,
  saveState: 'idle',
  isTooLong: false,
  isUnavailable: false,
  updatedAt: '2026-10-21T09:00:00.000Z',
};

const session: NoteSession = {
  subscribe: () => () => undefined,
  getSnapshot: () => READY,
  retain: () => () => undefined,
  setTitle: () => undefined,
  setDoc: () => undefined,
  flush: () => undefined,
  retry: () => undefined,
  dismissNotice: () => undefined,
};

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

/** Renders the window on a note, its delete answering with `answer` (by default, at once: it lands). */
async function renderWindow(answer: () => Promise<DataError | undefined> = () => Promise.resolve(undefined)) {
  const remove = vi.fn(answer);
  const restore = vi.fn(() => Promise.resolve(undefined));
  const onClose = vi.fn();
  const data = {
    notes: {
      newId: () => '0199a6f2-0000-7000-8000-0000000000ff',
      open: () => Promise.resolve(session),
      remove,
      restore,
    },
  } as unknown as DataLayer;
  const toasts = createToasts();
  const rootRoute = createRootRouteWithContext<{ data: DataLayer; toasts: Toasts }>()();
  const noteWindow = () => (
    <NoteWindow
      slug="acme"
      note={NOTE}
      record={RECORD}
      members={[]}
      canChange
      onStored={() => undefined}
      onClose={onClose}
    />
  );
  const notePage = createRoute({ getParentRoute: () => rootRoute, path: '/w/acme/note', component: noteWindow });
  const router = createRouter({
    routeTree: rootRoute.addChildren([notePage]),
    history: createMemoryHistory({ initialEntries: ['/w/acme/note'] }),
    context: { data, toasts },
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
  await expect.element(page.getByRole('dialog', { name: 'Kickoff call' })).toBeVisible();
  return { remove, restore, onClose };
}

/** Opens the window's More menu and picks Delete note: the confirm opens over the window. */
async function askToDelete() {
  await userEvent.click(page.getByRole('button', { name: 'More actions' }));
  await userEvent.click(page.getByRole('menuitem', { name: 'Delete note' }));
  await expect.element(page.getByRole('alertdialog', { name: 'Delete Kickoff call?' })).toBeVisible();
}

describe('deleting a note from its window', () => {
  it('asks first: Cancel, or Esc, changes nothing and leaves the note open', async () => {
    const { remove, onClose } = await renderWindow();
    await askToDelete();
    const confirm = page.getByRole('alertdialog', { name: 'Delete Kickoff call?' });
    await expect
      .element(confirm)
      .toMatchTextContent(/The note is deleted for everyone, and you can undo it for 10 seconds only\./);
    await userEvent.click(confirm.getByRole('button', { name: /Cancel/ }));
    await expect.element(confirm).not.toBeInTheDocument();
    await askToDelete();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
    await expect.element(page.getByRole('dialog', { name: 'Kickoff call' })).toBeVisible();
    expect(remove).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('deletes once on Delete note, busy until it lands, then closes the window and offers Undo', async () => {
    let land: (refusal: DataError | undefined) => void = () => undefined;
    const { remove, restore, onClose } = await renderWindow(
      () =>
        new Promise((resolve) => {
          land = resolve;
        }),
    );
    await askToDelete();
    const commit = page.getByRole('alertdialog').getByRole('button', { name: 'Delete note' });
    await userEvent.click(commit);
    // Busy while the server works: a second press sends nothing more, and Cancel waits too.
    await expect.element(commit).toHaveAttribute('data-pending', 'true');
    await expect.element(page.getByRole('alertdialog').getByRole('button', { name: /Cancel/ })).toBeDisabled();
    await userEvent.click(commit, { force: true });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    land(undefined);
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('acme', RECORD.recordId, NOTE);
    await expect.element(page.getByText('Note deleted')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Undo' }));
    expect(restore).toHaveBeenCalledWith('acme', RECORD.recordId, NOTE);
  });

  it('keeps the confirm open with the reason when the delete is refused', async () => {
    const { remove, onClose } = await renderWindow(() =>
      Promise.resolve(dataError('FORBIDDEN', 'You can view this note but not change it.')),
    );
    await askToDelete();
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Delete note' }));
    await expect
      .element(page.getByRole('alertdialog'))
      .toMatchTextContent(/The note wasn’t deleted\. You can view this note but not change it\./);
    await expect.element(page.getByRole('alertdialog').getByRole('button', { name: 'Delete note' })).toBeEnabled();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
