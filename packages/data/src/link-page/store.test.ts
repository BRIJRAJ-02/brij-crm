// The link page's store (spec 0051) against a fake API answered by hand: a change shows at once and is sent after
// the ones before it, a refusal puts the rows back and says why with Try again, a read sent before a write landed
// lands nothing, and the draft check says what the server will refuse before anything is sent.
import { describe, expect, it } from 'vitest';
import type { ProfileItem, ProfileItems } from '@crm/contracts';
import { dataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { refusalSummary } from '../refusals.ts';
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

const COUNTS = {
  days: 30,
  views: 12,
  visitors: 9,
  before: { views: 4, visitors: 3 },
  presses: [{ id: 'a', presses: 5 }],
};

function harness(first: ProfileItems = { items: [link('a'), link('b')], archived: [] }) {
  const calls: string[] = [];
  const saveListeners: ((input: unknown) => void)[] = [];
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
    // The figures answer at once and are left out of `calls`: the order of the writes is what these tests read.
    counts: () => Promise.resolve(COUNTS),
    pageChoices: () => wait('pageChoices'),
    formChoices: () => wait('formChoices'),
    saveTheme: ({ theme }) => Promise.resolve(theme),
    saveItem: (input) => {
      for (const listen of saveListeners) listen(input);
      return wait(`save:${input.id}`);
    },
    orderItems: (input) => wait(`order:${input.ids.join(',')}`),
    archiveItem: (input) => wait(`archive:${input.id}:${String(input.archived)}`),
    deleteItem: (input) => wait(`delete:${input.id}`),
  };
  let minted = 0;
  const store = createLinkPageStore({
    api,
    mintId: () => `m${String((minted += 1))}`,
    notify: (notice) => notices.push(notice),
    summary: refusalSummary,
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
  const refuseWith = (name: string, code: string, message: string) => {
    const found = answers.find((each) => each.name === name);
    if (found === undefined) throw new Error(`No call ${name}`);
    found.answer.reject(dataError(code as 'CONFIG_INVALID', message));
  };
  const onSave = (listen: (input: unknown) => void) => saveListeners.push(listen);
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
  return { store, calls, notices, answer, refuse, refuseWith, onSave, ready, shown, settle };
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

  it('reads the page’s figures when a screen holds it, not with every read of the blocks', async () => {
    const h = harness();
    await h.ready();
    await h.settle();
    const held = h.store.of('acme');
    expect(held.getSnapshot()).not.toHaveProperty('counts');
    held.retain();
    await h.settle();
    const state = held.getSnapshot();
    expect(state.status === 'ready' && state.counts).toEqual(COUNTS);
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

  it('leaves a refused add out of the order queued behind it, so only the add is refused', async () => {
    const h = harness();
    await h.ready();
    void h.store.save('acme', 'c', { kind: 'link', title: 'C', url: 'https://c.dev' }, link('c'));
    void h.store.order('acme', ['c', 'b', 'a']);
    await h.settle();
    h.refuse('save:c', 'A link page holds up to 40 links.');
    await h.settle();
    expect(h.calls).toContain('order:b,a');
    expect(h.notices).toHaveLength(1);
  });

  it('reads again after a limit refusal, so the Add menu catches up with another tab', async () => {
    const h = harness();
    await h.ready();
    void h.store.save('acme', 'c', { kind: 'link', title: 'C', url: 'https://c.dev' }, link('c'));
    await h.settle();
    const found = h.calls.indexOf('save:c');
    expect(found).toBeGreaterThan(-1);
    // A limit is LIMIT_REACHED: refused with its own code, not CONFIG_INVALID.
    h.refuseWith('save:c', 'LIMIT_REACHED', 'A link page holds up to 40 links.');
    await h.settle();
    expect(h.calls.filter((call) => call === 'items')).toHaveLength(2);
  });

  it('sends an edit as an edit, so a block another tab deleted is refused rather than made again', async () => {
    const h = harness();
    await h.ready();
    const sent: unknown[] = [];
    h.onSave((input) => sent.push(input));
    void h.store.save('acme', 'a', { kind: 'link', title: 'A2', url: 'https://a.dev' }, link('a', 'A2'));
    void h.store.save('acme', 'z', { kind: 'link', title: 'Z', url: 'https://z.dev' }, link('z'));
    await h.settle();
    h.answer('save:a', link('a', 'A2'));
    await h.settle();
    expect(sent).toEqual([
      expect.objectContaining({ id: 'a', isEdit: true }),
      expect.not.objectContaining({ isEdit: true }),
    ]);
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
        url: 'Use a web address, an email or a phone number.',
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
    const card = { kind: 'contact', id: 'c', fullName: 'Ada', updatedAt: '' } as const;
    expect(blockLimit([card], 'contact')).toBe('A link page holds one contact card.');
  });

  it('checks a contact card field by field, keeping only what was given', () => {
    expect(
      checkBlock(
        { kind: 'contact', fullName: ' Ada Lovelace ', jobTitle: '', email: 'ada@acme.dev', website: 'acme.dev' },
        items,
      ),
    ).toEqual({
      ok: true,
      block: { kind: 'contact', fullName: 'Ada Lovelace', email: 'ada@acme.dev', website: 'https://acme.dev' },
    });
    expect(
      checkBlock({ kind: 'contact', fullName: '', email: 'ada', phone: 'call me', website: 'mailto:a@b.co' }, items),
    ).toEqual({
      ok: false,
      problems: {
        fullName: 'Enter your name.',
        email: 'Enter an email address, like ana@example.com.',
        phone: 'Enter the number with its country code.',
        website: 'Use a web address, like timefix.com.',
      },
    });
  });
});
