// A record page's related sections in the browser (spec 0017, milestone 3)
// against a fake `links.page` answered from a list held here: the first page
// and Show more, this tab's own Remove and Add shown at once and kept until
// a read after the write, which changes concern a section, the reread's
// coalescing (two reads a second at most), and a side out of reach.
import type { LinkPage, RecordRefDisplay } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createLinkSections, SECTION_REFRESH_MS, type SectionKey } from './sections.ts';

const WS = 'acme';
const COMPANY = '0199a6f2-0000-7000-8000-0000000000aa';
const COMPANIES = '0199a6f2-0000-7000-8000-0000000000bb';
const PEOPLE = '0199a6f2-0000-7000-8000-0000000000cc';
const TEAM = '0199a6f2-0000-7000-8000-0000000000c1';
const OTHER = '0199a6f2-0000-7000-8000-0000000000c2';

const person = (n: number): RecordRefDisplay => ({
  objectId: PEOPLE,
  recordId: `0199a6f2-0000-7000-8000-${String(n).padStart(12, '0')}`,
  name: `Person ${String(n)}`,
  kind: 'person',
});

const SIDE: SectionKey = { recordId: COMPANY, objectId: COMPANIES, attributeId: TEAM, farObjectIds: [PEOPLE] };

/** Lets the promises answered so far settle. */
const flush = async () => {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

/** A fake server over `rows`, and a clock whose timers run when told. */
function setUp(count: number) {
  let rows = Array.from({ length: count }, (_, index) => person(index + 1));
  const calls: { cursor?: string; limit: number }[] = [];
  let refuse: Error | undefined;
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const page = (_workspace: string, input: { cursor?: string; limit: number }): Promise<LinkPage> => {
    calls.push({ ...(input.cursor === undefined ? {} : { cursor: input.cursor }), limit: input.limit });
    if (refuse !== undefined) return Promise.reject(refuse);
    const start = input.cursor === undefined ? 0 : Number(input.cursor);
    const items = rows.slice(start, start + input.limit);
    const end = start + items.length;
    return Promise.resolve({
      items,
      total: rows.length,
      ...(end < rows.length ? { nextCursor: String(end) } : {}),
    });
  };
  const sections = createLinkSections({
    page,
    later: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const tick = (ms: number) => {
    for (const timer of timers.splice(0)) {
      if (timer.cancelled) continue;
      if (timer.ms <= ms) timer.run();
      else timers.push(timer);
    }
  };
  return {
    sections,
    calls,
    tick,
    setRows: (next: readonly RecordRefDisplay[]) => {
      rows = [...next];
    },
    rows: () => rows,
    refuseWith: (error: Error | undefined) => {
      refuse = error;
    },
  };
}

const names = (items: readonly RecordRefDisplay[]) => items.map((item) => item.name);

describe('a related section', () => {
  it('reads its first 20 rows with the total, and 20 more with each Show more', async () => {
    const t = setUp(45);
    const section = t.sections.section(WS, SIDE);
    section.retain();
    expect(section.getSnapshot().status).toBe('loading');
    await flush();
    expect(section.getSnapshot()).toMatchObject({ status: 'ready', total: 45, hasMore: true });
    expect(section.getSnapshot().items).toHaveLength(20);
    section.showMore();
    expect(section.getSnapshot().isLoadingMore).toBe(true);
    await flush();
    section.showMore();
    await flush();
    expect(section.getSnapshot().items).toHaveLength(45);
    expect(section.getSnapshot().hasMore).toBe(false);
    expect(t.calls).toEqual([{ limit: 20 }, { cursor: '20', limit: 20 }, { cursor: '40', limit: 20 }]);
    // The sidebar and Overview share one source: one first read.
    expect(t.sections.section(WS, SIDE)).toBe(section);
  });

  it('shows a Remove at once, puts it back on a refusal, and keeps it until a read after the write', async () => {
    const t = setUp(3);
    const section = t.sections.section(WS, SIDE);
    section.retain();
    await flush();
    const gone = person(2);
    const refused = t.sections.hide(WS, COMPANY, TEAM, gone.recordId);
    expect(names(section.getSnapshot().items)).toEqual(['Person 1', 'Person 3']);
    expect(section.getSnapshot().total).toBe(2);
    refused?.settle(false);
    expect(names(section.getSnapshot().items)).toEqual(['Person 1', 'Person 2', 'Person 3']);
    expect(section.getSnapshot().total).toBe(3);

    const landed = t.sections.hide(WS, COMPANY, TEAM, gone.recordId);
    // The server removed it; this tab's own write reads the section again (`landed`), then the write settles.
    t.setRows([person(1), person(3)]);
    t.sections.ownWrite(WS);
    landed?.settle(true);
    expect(section.getSnapshot().total).toBe(2);
    await flush();
    expect(names(section.getSnapshot().items)).toEqual(['Person 1', 'Person 3']);
    expect(section.getSnapshot().total).toBe(2);
    t.tick(SECTION_REFRESH_MS);
    await flush();
    expect(section.getSnapshot().total).toBe(2);
  });

  it('shows an Add at the end when every row is held, and only in the total past them', async () => {
    const t = setUp(2);
    const section = t.sections.section(WS, SIDE);
    section.retain();
    await flush();
    t.sections.show(WS, COMPANY, TEAM, person(9));
    expect(names(section.getSnapshot().items)).toEqual(['Person 1', 'Person 2', 'Person 9']);
    expect(section.getSnapshot().total).toBe(3);

    const long = setUp(30);
    const many = long.sections.section(WS, SIDE);
    many.retain();
    await flush();
    const added = long.sections.show(WS, COMPANY, TEAM, person(99));
    expect(many.getSnapshot().items).toHaveLength(20);
    expect(many.getSnapshot().total).toBe(31);
    // A read that already counts it leaves the total as it answered.
    long.setRows([...long.rows(), person(99)]);
    long.sections.ownWrite(WS);
    added?.settle(true);
    await flush();
    expect(many.getSnapshot().total).toBe(31);
  });

  it('reads again for a change naming its record and side, a row it holds, or its far object’s trash', async () => {
    const t = setUp(2);
    const section = t.sections.section(WS, SIDE);
    section.retain();
    await flush();
    const reads = () => t.calls.length;
    const before = reads();
    // Another side of the same record: not this section.
    t.sections.changed(WS, { objectId: COMPANIES, recordIds: [COMPANY], attributeIds: [OTHER] });
    // A coarse change to an object it doesn't show.
    t.sections.changed(WS, { objectId: OTHER, recordIds: [], coarse: true });
    expect(reads()).toBe(before);
    t.setRows([person(1), { ...person(2), name: 'Renamed' }]);
    t.sections.changed(WS, { objectId: PEOPLE, recordIds: [person(2).recordId], attributeIds: [OTHER] });
    await flush();
    expect(names(section.getSnapshot().items)).toEqual(['Person 1', 'Renamed']);
    expect(reads()).toBe(before + 1);
    // Within the cool down, a burst waits for one more read after it.
    t.sections.changed(WS, { objectId: COMPANIES, recordIds: [COMPANY], attributeIds: [TEAM] });
    t.sections.changed(WS, { objectId: PEOPLE, recordIds: [], deletedIds: ['x'] });
    await flush();
    expect(reads()).toBe(before + 1);
    t.tick(SECTION_REFRESH_MS);
    await flush();
    expect(reads()).toBe(before + 2);
  });

  it('waits while nobody shows it, and reads what changed once shown again', async () => {
    const t = setUp(1);
    const section = t.sections.section(WS, SIDE);
    const release = section.retain();
    await flush();
    release();
    const before = t.calls.length;
    t.sections.changed(WS, { objectId: COMPANIES, recordIds: [COMPANY], attributeIds: [TEAM] });
    await flush();
    expect(t.calls.length).toBe(before);
    section.retain();
    await flush();
    expect(t.calls.length).toBe(before + 1);
  });

  it('goes out of reach on NOT_FOUND, and shows a failed first read with Try again', async () => {
    const t = setUp(1);
    t.refuseWith(
      Object.assign(new Error('That relationship is not on this record.'), { name: 'DataError', code: 'NOT_FOUND' }),
    );
    const section = t.sections.section(WS, SIDE);
    section.retain();
    await flush();
    expect(section.getSnapshot().status).toBe('unavailable');

    const failing = setUp(1);
    failing.refuseWith(Object.assign(new Error('Try again.'), { name: 'DataError', code: 'API_UNAVAILABLE' }));
    const other = failing.sections.section(WS, SIDE);
    other.retain();
    await flush();
    expect(other.getSnapshot().status).toBe('error');
    failing.refuseWith(undefined);
    other.retry();
    await flush();
    expect(other.getSnapshot()).toMatchObject({ status: 'ready', total: 1 });
  });
});
