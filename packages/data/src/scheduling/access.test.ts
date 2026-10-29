import type { DelegationView } from '@crm/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Notice } from '../notice.ts';
import {
  createSchedulingAccessStore,
  involves,
  withGrant,
  type DelegationsState,
  type SchedulingAccessApi,
} from './access.ts';

const W = 'acme';
const ME = '00000000-0000-7000-8000-000000000001';
const PRIYA = '00000000-0000-7000-8000-000000000002';
const SAM = '00000000-0000-7000-8000-000000000003';

const over = (delegate: string, target: string, level: 'view' | 'manage', id = `d-${delegate}`): DelegationView => ({
  id,
  delegateMemberId: delegate,
  target: { type: 'member', memberId: target },
  level,
  grantedBySelf: true,
  grantedBy: target,
  createdAt: '2026-10-29T10:00:00.000Z',
});

/** A deferred promise a test settles by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(initial: readonly DelegationView[] = []) {
  const notices: Notice[] = [];
  let stored = [...initial];
  const api = {
    list: vi.fn(() => Promise.resolve({ delegations: [...stored] })),
    grant: vi.fn<SchedulingAccessApi['grant']>(),
    revoke: vi.fn<SchedulingAccessApi['revoke']>(),
    visible: vi.fn(() => Promise.resolve({ members: [{ id: ME, name: 'Me', canManage: true, canChangeHours: true }] })),
  };
  let clock = 0;
  const store = createSchedulingAccessStore({
    api,
    mintId: () => 'temp-id',
    notify: (notice) => notices.push(notice),
    now: () => clock,
  });
  return {
    api,
    store,
    notices,
    setStored: (next: DelegationView[]) => {
      stored = next;
    },
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const ready = (state: DelegationsState) => (state.status === 'ready' ? state.delegations : undefined);

describe('the pure helpers', () => {
  it('lays a grant over a list: a new row, or the same delegate and target at the new level', () => {
    const one = over(PRIYA, ME, 'view');
    const added = withGrant(
      [],
      { delegateMemberId: PRIYA, target: { type: 'member', memberId: ME }, level: 'view' },
      'x',
      ME,
      'at',
    );
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ id: 'x', grantedBySelf: true });
    const changed = withGrant(
      [one],
      { delegateMemberId: PRIYA, target: { type: 'member', memberId: ME }, level: 'manage' },
      'x',
      ME,
      'at',
    );
    expect(changed).toEqual([{ ...one, level: 'manage' }]);
  });

  it('knows which delegations a member’s own list holds', () => {
    expect(involves(over(PRIYA, ME, 'view'), ME)).toBe(true);
    expect(involves(over(PRIYA, SAM, 'view'), ME)).toBe(false);
    expect(involves({ delegateMemberId: ME, target: { type: 'everyone' } }, ME)).toBe(true);
  });
});

describe('the held lists', () => {
  it('reads when first held, and the workspace list asks for everyone', async () => {
    const t = setup([over(PRIYA, ME, 'view')]);
    const mine = t.store.delegations(W, 'mine');
    await mine.ready();
    expect(ready(mine.getSnapshot())).toHaveLength(1);
    await t.store.delegations(W, 'everyone').ready();
    expect(t.api.list).toHaveBeenLastCalledWith({ workspace: W, everyone: true });
  });

  it('shows a grant at once and puts the answer in place', async () => {
    const t = setup();
    const mine = t.store.delegations(W, 'mine');
    await mine.ready();
    const answer = deferred<DelegationView>();
    t.api.grant.mockReturnValueOnce(answer.promise);
    const landing = t.store.grant(W, ME, {
      delegateMemberId: PRIYA,
      target: { type: 'member', memberId: ME },
      level: 'manage',
    });
    expect(ready(mine.getSnapshot())?.[0]).toMatchObject({ id: 'temp-id', level: 'manage' });
    answer.resolve(over(PRIYA, ME, 'manage', 'real'));
    expect(await landing).toBe(true);
    expect(ready(mine.getSnapshot())?.map((each) => each.id)).toEqual(['real']);
  });

  it('puts a refused grant back, a changed level to the old one, and says why', async () => {
    const t = setup([over(PRIYA, ME, 'view')]);
    const mine = t.store.delegations(W, 'mine');
    await mine.ready();
    t.api.grant.mockRejectedValueOnce(new Error('nope'));
    const landed = await t.store.grant(W, ME, {
      delegateMemberId: PRIYA,
      target: { type: 'member', memberId: ME },
      level: 'manage',
    });
    expect(landed).toBe(false);
    expect(ready(mine.getSnapshot())).toEqual([over(PRIYA, ME, 'view')]);
    expect(t.notices).toHaveLength(1);
    expect(t.notices[0]?.tone).toBe('danger');
  });

  it('takes a removal away at once, and puts a refused one back where it was', async () => {
    const first = over(PRIYA, ME, 'view');
    const second = over(SAM, ME, 'manage');
    const t = setup([first, second]);
    const mine = t.store.delegations(W, 'mine');
    await mine.ready();
    const answer = deferred<undefined>();
    t.api.revoke.mockReturnValueOnce(answer.promise);
    const removing = t.store.revoke(W, ME, first);
    expect(ready(mine.getSnapshot())).toEqual([second]);
    answer.reject(new Error('nope'));
    expect(await removing).toBe(false);
    expect(ready(mine.getSnapshot())).toEqual([first, second]);
  });

  it('leaves a delegation out of the member’s own list when it doesn’t name them', async () => {
    const t = setup();
    const mine = t.store.delegations(W, 'mine');
    const everyone = t.store.delegations(W, 'everyone');
    await Promise.all([mine.ready(), everyone.ready()]);
    t.api.grant.mockResolvedValueOnce(over(PRIYA, SAM, 'view', 'real'));
    await t.store.grant(W, ME, { delegateMemberId: PRIYA, target: { type: 'member', memberId: SAM }, level: 'view' });
    expect(ready(mine.getSnapshot())).toEqual([]);
    expect(ready(everyone.getSnapshot())?.map((each) => each.id)).toEqual(['real']);
  });

  it('drops a read sent before a write landed, and reads again', async () => {
    const t = setup();
    const mine = t.store.delegations(W, 'mine');
    await mine.ready();
    const slow = deferred<{ delegations: DelegationView[] }>();
    t.api.list.mockReturnValueOnce(slow.promise);
    t.tick(5_000);
    mine.reload();
    t.api.grant.mockResolvedValueOnce(over(PRIYA, ME, 'view', 'real'));
    await t.store.grant(W, ME, { delegateMemberId: PRIYA, target: { type: 'member', memberId: ME }, level: 'view' });
    t.setStored([over(PRIYA, ME, 'view', 'real')]);
    slow.resolve({ delegations: [] });
    await vi.waitFor(() => {
      expect(t.api.list).toHaveBeenCalledTimes(3);
    });
    await vi.waitFor(() => {
      expect(ready(mine.getSnapshot())?.map((each) => each.id)).toEqual(['real']);
    });
  });

  it('keeps a saved grant when a read sent during it answers first without it', async () => {
    const t = setup();
    const mine = t.store.delegations(W, 'mine');
    await mine.ready();
    const answer = deferred<DelegationView>();
    t.api.grant.mockReturnValueOnce(answer.promise);
    const landing = t.store.grant(W, ME, {
      delegateMemberId: PRIYA,
      target: { type: 'member', memberId: ME },
      level: 'view',
    });
    const read = deferred<{ delegations: DelegationView[] }>();
    t.api.list.mockReturnValueOnce(read.promise);
    t.tick(5_000);
    mine.reload();
    read.resolve({ delegations: [] });
    await Promise.resolve();
    expect(ready(mine.getSnapshot())?.map((each) => each.id)).toEqual(['temp-id']);
    t.setStored([over(PRIYA, ME, 'view', 'real')]);
    answer.resolve(over(PRIYA, ME, 'view', 'real'));
    expect(await landing).toBe(true);
    await vi.waitFor(() => {
      expect(ready(mine.getSnapshot())?.map((each) => each.id)).toEqual(['real']);
    });
  });

  it('keeps a removal gone when a read sent during it answers with the row', async () => {
    const first = over(PRIYA, ME, 'view');
    const t = setup([first]);
    const mine = t.store.delegations(W, 'mine');
    await mine.ready();
    const answer = deferred<undefined>();
    t.api.revoke.mockReturnValueOnce(answer.promise);
    const removing = t.store.revoke(W, ME, first);
    t.tick(5_000);
    mine.reload();
    await Promise.resolve();
    t.setStored([]);
    answer.resolve(undefined);
    expect(await removing).toBe(true);
    await vi.waitFor(() => {
      expect(ready(mine.getSnapshot())).toEqual([]);
    });
  });

  it('reads every held list and the reach again on an access change', async () => {
    const t = setup();
    await t.store.delegations(W, 'mine').ready();
    await t.store.visible(W);
    await t.store.visible(W);
    expect(t.api.visible).toHaveBeenCalledTimes(1);
    t.store.reload(W);
    await t.store.visible(W);
    expect(t.api.visible).toHaveBeenCalledTimes(2);
    expect(t.api.list).toHaveBeenCalledTimes(2);
  });
});
