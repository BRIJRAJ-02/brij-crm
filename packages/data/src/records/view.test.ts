// The view as the grid reads it: a new snapshot only when something it shows
// changed, at most once a frame.
import { describe, expect, it } from 'vitest';
import { createPlainStore } from './plain-store.ts';
import type { RecordBody } from './store.ts';
import { createRecordView } from './view.ts';
import { createWindows } from './windows.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const row = (id: string, name: string): RecordBody => ({ id, values: { name } });

/** A view over 300 records whose blocks answer at once, with frames the test runs by hand. */
function setup() {
  const store = createPlainStore<RecordBody>();
  const frames: (() => void)[] = [];
  const windows = createWindows({
    count: 300,
    load: (offset, limit) => {
      const rows = Array.from({ length: limit }, (_, index) => row(`id-${String(offset + index)}`, 'P'));
      store.receive(rows, { hold: true });
      return Promise.resolve(rows.map((each) => each.id));
    },
    release: store.release,
  });
  const view = createRecordView({ store, windows, schedule: (flush) => frames.push(flush) });
  let renders = 0;
  view.subscribe(() => (renders += 1));
  const frame = () => {
    for (const flush of frames.splice(0)) flush();
  };
  return { store, view, frame, renders: () => renders, frames };
}

describe('the record view', () => {
  it('renders a block load once, though the store and the windows both change', async () => {
    const { view, frame, renders } = setup();
    view.getSnapshot().onRangeChange({ start: 0, end: 40 });
    await settle();
    frame();
    expect(renders()).toBe(1);
    expect(view.getSnapshot().getItem(5)?.id).toBe('id-5');
  });

  it('keeps its snapshot for a change to a record no loaded block holds', async () => {
    const { store, view, frame, renders, frames } = setup();
    view.getSnapshot().onRangeChange({ start: 0, end: 40 });
    await settle();
    frame();
    const before = view.getSnapshot();
    // Held elsewhere (an open record page), not in this view's windows.
    store.hold(['elsewhere']);
    store.receive([row('elsewhere', 'Grace')]);
    store.edit('elsewhere', { name: 'Grace H' }, 'm1');
    expect(frames).toHaveLength(0);
    frame();
    expect(view.getSnapshot()).toBe(before);
    expect(renders()).toBe(1);
  });

  it('batches many changes to loaded records into one render a frame', async () => {
    const { store, view, frame, renders } = setup();
    view.getSnapshot().onRangeChange({ start: 0, end: 140 });
    await settle();
    frame();
    const before = view.getSnapshot();
    store.edit('id-1', { name: 'A' }, 'm1');
    store.edit('id-2', { name: 'B' }, 'm2');
    store.receive([row('id-120', 'C')]);
    frame();
    expect(renders()).toBe(2);
    expect(view.getSnapshot()).not.toBe(before);
    expect(view.getSnapshot().getItem(2)?.values.name).toBe('B');
  });

  it('renders again when its screen says something else changed', () => {
    const { view, frame, renders } = setup();
    view.invalidate();
    view.invalidate();
    frame();
    expect(renders()).toBe(1);
  });
});
