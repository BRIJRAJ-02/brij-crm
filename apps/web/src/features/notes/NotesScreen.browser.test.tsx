// The workspace's Notes page in Chromium (the foolproof pass, 5 November 2026): New note for whoever may change some
// object, absent for a reader; its picker starts where the newest note was written, with the search ready to type,
// and a pick opens the new note on that record.
import type {
  DataLayer,
  NoteList,
  NoteListState,
  NoteSummary,
  ObjectSummary,
  RecordRefDisplay,
  RecordSearch,
  RecordSearchState,
} from '@crm/data';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { NotesScreen } from './NotesScreen.tsx';

const object = (id: string, plural: string, access: 'read' | 'write', position: number): ObjectSummary => ({
  id,
  apiSlug: plural.toLowerCase(),
  singularName: plural.slice(0, -1),
  pluralName: plural,
  icon: 'box',
  hue: 'blue',
  access,
  position,
  isStandard: true,
  isArchived: false,
});
const PEOPLE_ID = '01a1a000-0000-7000-8000-000000000001';
const DEALS_ID = '01a1a000-0000-7000-8000-000000000002';
const APOLLO: RecordRefDisplay = {
  objectId: DEALS_ID,
  recordId: '01a1a000-0000-7000-8000-0000000000a1',
  name: 'Apollo',
  kind: 'other',
};

const ADA = { type: 'member', id: '01a1a000-0000-7000-8000-0000000000ad' } as const;
const KICKOFF: NoteSummary = {
  id: '01a1a000-0000-7000-8000-0000000000b1',
  recordId: APOLLO.recordId,
  title: 'Kickoff call',
  excerpt: '',
  version: 1,
  kind: 'note',
  occurredAt: '2026-10-08T09:00:00.000Z',
  canChange: true,
  createdAt: '2026-10-08T09:00:00.000Z',
  createdBy: ADA,
  updatedAt: '2026-10-08T09:00:00.000Z',
  updatedBy: ADA,
  record: APOLLO,
};

/** The page's list, ready with `notes`. One snapshot, the same each read, as a store's must be. */
const listOf = (notes: readonly NoteSummary[]): NoteList => {
  const state: NoteListState = {
    status: 'ready',
    source: {
      count: notes.length,
      getItem: (index) => notes[index],
      getKey: (note) => note.id,
      onRangeChange: () => undefined,
    },
  };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    retry: () => undefined,
  };
};

/** A search that answers at once with Apollo, whatever is typed. */
function apolloSearch(): RecordSearch {
  let state: RecordSearchState = { query: '', status: 'idle', results: [] };
  const listeners = new Set<() => void>();
  return {
    ask: (asked) => {
      const query = asked.trim();
      if (query === state.query && state.status === 'ready') return;
      state = { query, status: 'ready', results: [{ ref: APOLLO, linked: false }] };
      queueMicrotask(() => {
        for (const listener of listeners) listener();
      });
    },
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resultOf: (recordId) => (recordId === APOLLO.recordId ? { ref: APOLLO, linked: false } : undefined),
    dispose: () => undefined,
  };
}

let app: InApp | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
});

const show = async (objects: readonly ObjectSummary[], notes: readonly NoteSummary[]) => {
  app = await renderInApp(() => <NotesScreen slug="acme" list={listOf(notes)} objects={objects} members={[]} />, {
    data: { records: { search: apolloSearch } as unknown as DataLayer['records'] },
    pattern: '/w/$slug/notes',
    at: '/w/acme/notes',
  });
  return app;
};

describe('NotesScreen', () => {
  it('offers no New note to someone who may change no object, and says nothing they could not follow', async () => {
    await show([object(PEOPLE_ID, 'People', 'read', 0), object(DEALS_ID, 'Deals', 'read', 1)], []);
    await expect.element(page.getByText('No notes yet')).toBeVisible();
    expect(page.getByRole('button', { name: 'New note' }).elements()).toHaveLength(0);
    expect(page.getByText('Write notes on a record.').elements()).toHaveLength(0);
  });

  it('starts New note where the newest note was written, ready to search, and a pick opens the note there', async () => {
    const shown = await show(
      [object(PEOPLE_ID, 'People', 'write', 0), object(DEALS_ID, 'Deals', 'write', 1)],
      [KICKOFF],
    );
    await userEvent.click(page.getByRole('button', { name: 'New note' }));
    await expect.element(page.getByRole('dialog', { name: 'New note' })).toBeVisible();
    // Search in starts on Deals (the newest note's object), and the search has focus.
    await expect.element(page.getByRole('button', { name: /Search in/u })).toHaveTextContent('Deals');
    await expect.element(page.getByRole('searchbox')).toHaveFocus();
    await userEvent.keyboard('Apo');
    // The picker's rows sit in a list the test page doesn't size, so the keys pick one, as a keyboard user does.
    await expect.element(page.getByRole('menuitem', { name: /Apollo/u })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect
      .poll(() => shown.router.state.location.href)
      .toBe(`/w/acme/objects/deals/${APOLLO.recordId}/notes?note=new`);
  });
});
