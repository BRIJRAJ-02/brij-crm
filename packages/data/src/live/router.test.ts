// The live router (spec 0007, AC-79): a handler slot for every kind of the
// contract's ChangeEvent, so a new kind fails here until the client knows it,
// and dispatch only to the handlers of the event's own kind.
import { CHANGE_EVENT_KINDS, type ChangeEvent } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { parseChangeEvent } from './live.ts';
import { createLiveRouter, LIVE_KINDS } from './router.ts';

const AT = '2026-10-08T09:00:00.000Z';
const ID = '0199a6f2-0000-7000-8000-00000000000a';

/** One valid event of each kind, as the server sends it. */
const SAMPLES: Readonly<Record<ChangeEvent['kind'], ChangeEvent>> = {
  records: { seq: 1, at: AT, kind: 'records', objectId: ID, recordIds: [ID], attributeIds: [] },
  entries: { seq: 1, at: AT, kind: 'entries', listId: ID, entryIds: [ID], recordIds: [ID], attributeIds: [] },
  definitions: { seq: 1, at: AT, kind: 'definitions', listId: ID },
  views: { seq: 1, at: AT, kind: 'views', objectId: ID, viewIds: [ID] },
  notes: { seq: 1, at: AT, kind: 'notes', recordIds: [ID], noteIds: [ID] },
  tasks: { seq: 1, at: AT, kind: 'tasks', recordIds: [ID], taskIds: [ID], coarse: true },
  members: { seq: 1, at: AT, kind: 'members', memberIds: [ID] },
  access: { seq: 1, at: AT, kind: 'access', memberIds: [ID] },
  jobs: { seq: 1, at: AT, kind: 'jobs', jobIds: [ID] },
  restricted: { seq: 1, at: AT, kind: 'restricted' },
};

describe('the live router', () => {
  it('has a handler slot for every kind of the contract but the stub (AC-79)', () => {
    expect([...LIVE_KINDS].sort()).toEqual(CHANGE_EVENT_KINDS.filter((kind) => kind !== 'restricted').sort());
  });

  it('parses every kind of the contract whole', () => {
    for (const kind of CHANGE_EVENT_KINDS) expect(parseChangeEvent(SAMPLES[kind])?.event, kind).toEqual(SAMPLES[kind]);
  });

  it('hands an event to its kind’s handlers only, and a resync to every store', () => {
    const router = createLiveRouter();
    const heard: string[] = [];
    const stop = router.on('members', (workspace, event) => heard.push(`${workspace} ${event.memberIds.join()}`));
    router.onResync((workspace) => heard.push(`resync ${workspace}`));
    router.dispatch('acme', SAMPLES.members);
    router.dispatch('acme', SAMPLES.records);
    router.dispatch('acme', SAMPLES.restricted);
    router.resync('acme');
    stop();
    router.dispatch('acme', SAMPLES.members);
    expect(heard).toEqual([`acme ${ID}`, 'resync acme']);
  });
});
