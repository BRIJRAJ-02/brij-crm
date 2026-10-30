// How long a workspace link's slots read takes as "Everyone on the roster" grows (spec 0029, AC-737's budget: a 20
// member page's slots in 1.5 s at p75), against the real Postgres: 20, 50 and 100 members, each with their own hours
// and a few bookings, a month's slots read 12 times after two warm ups, the p50, p75 and p95 printed. Calendars
// answer at once here, so this measures the database and the engine, not the providers. Opt in, it is slow:
// `WSLINK_BENCH=1 vitest run src/rotation/workspace-link.bench.test.ts`.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { defaultAvailability } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingPage } from '../access/door.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import type { BookingCalendar } from '../booking/calendar.ts';
import { createBookingPage } from '../booking/pages.ts';
import { bookPublicSlot, readPublicSlots } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
const RUNS = 12;
const WARM_UPS = 2;
const NOW = new Date('2026-11-01T00:00:00.000Z');
const calendar: BookingCalendar = {
  busy: () => Promise.resolve({ status: 'none' }),
  events: () => Promise.resolve({ meetingId: newId() }),
};
const deps = { calendar, now: () => NOW, linkKey: Buffer.alloc(32, 3) };

let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-workspace-link-bench' });
});
afterAll(async () => {
  await db.close();
});

/** The value at `share` (0 to 1) of sorted timings. */
const at = (sorted: readonly number[], share: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)] ?? 0;

/** A workspace of `size` members (its owner among them), weekdays with staggered hours, and its workspace link. */
async function rosterOf(size: number) {
  const created = await createWorkspace(db, {
    name: 'Bench',
    slug: `wslink-bench-${String(size)}-${String(Date.now())}`,
    firstMember: { name: 'Owner', email: `owner-${String(size)}@bench.example` },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  for (let index = 1; index < size; index += 1) {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${`Member ${String(index)}`}, ${`m${String(index)}-${id.slice(-6)}@bench.example`}, 'member', 'system', 'system')`,
      ),
    );
    const start = `${String(8 + (index % 4)).padStart(2, '0')}:00`;
    const range: [string, string] = [start, '17:00'];
    await saveDefaultHours(rescope(owner, { actor: { type: 'member', id }, role: 'member' }), {
      availability: {
        ...defaultAvailability('UTC'),
        weekly: { mon: [range], tue: [range], wed: [range], thu: [range], fri: [range], sat: [], sun: [] },
      },
    });
  }
  const page = await createBookingPage(
    owner,
    { id: newId(), title: 'Talk to us', timeZone: 'UTC', scope: 'workspace' },
    NOW,
  );
  const entry = await enterBookingPage({ db }, page.publicKey);
  // A booking a member, so the ledger, caps and bookings have rows to read.
  for (let index = 0; index < Math.min(size, 20); index += 1) {
    await bookPublicSlot(entry, deps, {
      idempotencyKey: newId(),
      start: `2026-11-0${String(2 + (index % 4))}T${String(10 + Math.floor(index / 4)).padStart(2, '0')}:00:00.000Z`,
      duration: 30,
      name: `Visitor ${String(index)}`,
      email: `v${String(index)}@client.example`,
      timeZone: 'UTC',
    });
  }
  return entry;
}

describe.runIf(process.env.WSLINK_BENCH === '1')('a workspace link’s slots read as the roster grows', () => {
  for (const size of [20, 50, 100]) {
    it(`reads a month of slots for ${String(size)} members`, async () => {
      const entry = await rosterOf(size);
      const timings: number[] = [];
      let slots = 0;
      for (let run = 0; run < WARM_UPS + RUNS; run += 1) {
        const started = performance.now();
        const read = await readPublicSlots(entry, deps, {
          from: '2026-11-01T00:00:00.000Z',
          to: '2026-12-01T00:00:00.000Z',
          duration: 30,
          tz: 'UTC',
        });
        if (run >= WARM_UPS) timings.push(performance.now() - started);
        slots = read.slots.length;
      }
      const sorted = [...timings].sort((left, right) => left - right);
      // A measurement, printed for the reader of the run (warn is the console method lint allows).
      console.warn(
        `wslink bench: ${String(size)} members, ${String(slots)} slots: p50 ${at(sorted, 0.5).toFixed(0)} ms, p75 ${at(sorted, 0.75).toFixed(0)} ms, p95 ${at(sorted, 0.95).toFixed(0)} ms`,
      );
      expect(slots).toBeGreaterThan(0);
    }, 600_000);
  }
});
