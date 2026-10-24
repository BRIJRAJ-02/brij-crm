// The link page's store (spec 0051) against a fake API answered by hand: a change shows at once and is sent after
// the ones before it, a refusal puts the rows back and says why with Try again, a read sent before a write landed
// lands nothing, and the draft check says what the server will refuse before anything is sent.
import { describe, expect, it } from 'vitest';
import type { ProfileItem, ProfileItems } from '@crm/contracts';
import { dataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { blockLimit, checkBlock, createLinkPageStore, type LinkPageApi } from './store.ts';

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

const link = (id: string, title = id): ProfileItem => ({
  kind: 'link',
  id,
  title,
  url: `https://${id}.dev`,
  hue: 'blue',
  updatedAt: '2026-10-25T00:00:00.000Z',
});
const heading = (id: string, title: string): ProfileItem => ({
  kind: 'heading',
  id,
  title,
  updatedAt: '2026-10-25T00:00:00.000Z',
});

function harness(first: ProfileItems = { items: [link('a'), link('b')], archived: [] }) {
  const calls: string[] = [];
  const answers: { readonly name: string; readonly answer: ReturnType<typeof deferred<unknown>> }[] = [];
  const notices: Notice[] = [];
  const wait = <T>(name: string): Promise<T> => {
    calls.push(name);
    const answer = deferred<unknown>();
    answers.push({ name, answer });
    return answer.promise as Promise<T>;
  };
  const api: LinkPageApi = {
    items: () => wait('items'),
    pageChoices: () => wait('pageChoices'),
    saveItem: (input) => wait(`save:${input.id}`),
    orderItems: (input) => wait(`order:${input.ids.join(',')}`),
    archiveItem: (input) => wait(`archive:${input.id}:${String(input.archived)}`),
    deleteItem: (input) => wait(`delete:${input.id}`),
  };
  let minted = 0;
  const store = createLinkPageStore({
    api,
    mintId: () => `m${String((minted += 1))}`,
    notify: (notice) => notices.push(notice),
    now: () => 0,
  });
  const answer = (name: string, value: unknown) => {
    const found = answers.find((each) => each.name === name);
    if (found === undefined) throw new Error(`No call ${name}`);
    found.answer.resolve(value);
  };
  const refuse = (name: string, message: string) => {
    const found = answers.find((each) => each.name === name);
    if (found === undefined) throw new Error(`No call ${name}`);
    found.answer.reject(dataError('CONFIG_INVALID', message));
  };
  const ready = async () => {
    const reading = store.read('acme');
    answer('items', first);
    await reading;
  };
  const shown = () => {
    const state = store.of('acme').getSnapshot();
    return state.status === 'ready' ? state.items.map((item) => item.id) : state.status;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { store, calls, notices, answer, refuse, ready, shown, settle };
}

describe('the link page store', () => {
  it('shows an add at once, marked pending, and puts the answer in place', async () => {
    const h = harness();
    await h.ready();
    const saving = h.store.save('acme', 'c', { kind: 'link', title: 'C', url: 'https://c.dev' }, link('c', 'C'));
    expect(h.shown()).toEqual(['a', 'b', 'c']);
    const state = h.store.of('acme').getSnapshot();
    expect(state.status === 'ready' && [...state.pendingIds]).toEqual(['c']);
    await h.settle();
    h.answer('save:c', link('c', 'C from the server'));
    expect(await saving).toBe(true);
    const after = h.store.of('acme').getSnapshot();
    expect(after.status === 'ready' && after.items.at(-1)).toMatchObject({ title: 'C from the server' });
    expect(after.status === 'ready' && after.pendingIds.size).toBe(0);
  });

  it('sends an order only after the add before it landed', async () => {
    const h = harness();
    await h.ready();
    void h.store.save('acme', 'c', { kind: 'link', title: 'C', url: 'https://c.dev' }, link('c'));
    void h.store.order('acme', ['c', 'a', 'b']);
    expect(h.shown()).toEqual(['c', 'a', 'b']);
    await h.settle();
    expect(h.calls).toEqual(['items', 'save:c']);
    h.answer('save:c', link('c'));
    await h.settle();
    expect(h.calls.at(-1)).toBe('order:c,a,b');
  });

  it('puts a refused change back and says why, with Try again', async () => {
    const h = harness();
    await h.ready();
    const moving = h.store.order('acme', ['b', 'a']);
    expect(h.shown()).toEqual(['b', 'a']);
    await h.settle();
    h.refuse('order:b,a', 'Your link page changed somewhere else.');
    expect(await moving).toBe(false);
    expect(h.shown()).toEqual(['a', 'b']);
    expect(h.notices).toEqual([
      expect.objectContaining({ tone: 'danger', message: 'Your link page changed somewhere else.' }),
    ]);
    // The refusal reads the lists again behind the toast.
    expect(h.calls.filter((call) => call === 'items')).toHaveLength(2);
  });

  it('archives and restores in place, and deletes', async () => {
    const h = harness();
    await h.ready();
    void h.store.archive('acme', 'a', true);
    const state = h.store.of('acme').getSnapshot();
    expect(
      state.status === 'ready' && [state.items.map((item) => item.id), state.archived.map((item) => item.id)],
    ).toEqual([['b'], ['a']]);
    void h.store.remove('acme', 'b');
    expect(h.shown()).toEqual([]);
  });

  it('never lets a read sent before a write landed put its older answer over it', async () => {
    const h = harness();
    await h.ready();
    h.store.of('acme').retry();
    void h.store.save('acme', 'c', { kind: 'link', title: 'C', url: 'https://c.dev' }, link('c'));
    await h.settle();
    h.answer('save:c', link('c'));
    await h.settle();
    h.answer('items', { items: [link('a'), link('b')], archived: [] });
    await h.settle();
    expect(h.shown()).toEqual(['a', 'b', 'c']);
  });
});

describe('checkBlock', () => {
  const items = [heading('h', 'Sales'), link('a')];

  it('makes a link canonical and keeps only what was given', () => {
    expect(checkBlock({ kind: 'link', title: ' Site ', url: 'ada.dev', note: ' ' }, items)).toEqual({
      ok: true,
      block: { kind: 'link', title: 'Site', url: 'https://ada.dev' },
    });
  });

  it('says what is wrong, field by field, before anything is sent', () => {
    expect(checkBlock({ kind: 'link', title: '', url: 'javascript:alert(1)', note: 'x'.repeat(121) }, items)).toEqual({
      ok: false,
      problems: {
        title: 'Give the link a title.',
        url: 'That address can’t be a link.',
        note: 'Keep the note to 120 characters.',
      },
    });
    expect(checkBlock({ kind: 'heading', title: ' sales ' }, items)).toEqual({
      ok: false,
      problems: { title: 'You already have a heading called that.' },
    });
    // Its own text is no twin while it is edited.
    expect(checkBlock({ kind: 'heading', title: 'SALES' }, items, 'h')).toMatchObject({ ok: true });
    expect(checkBlock({ kind: 'page' }, items)).toEqual({ ok: false, problems: { page: 'Pick a booking page.' } });
  });

  it('says a full kind’s limit', () => {
    const many = Array.from({ length: 12 }, (_, n) => heading(`h${String(n)}`, `H ${String(n)}`));
    expect(blockLimit(many, 'heading')).toBe('A link page holds up to 12 headings.');
    expect(blockLimit(many, 'link')).toBeUndefined();
  });
});
