// Workspace changes' paged read (spec 0046, AC-4629, AC-4630): each status, Show
// more with the cursor, Try again for a first and a later page, 403 as its
// own state, and dispose aborting the read still out.
import type { AuditEntryView, AuditListInput, AuditPage } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError, type DataErrorCode } from '../errors.ts';
import { openAuditLog, type AuditLogState } from './log.ts';

/** A coded failure as the data layer's `call` raises it. */
const failure = (code: DataErrorCode, message: string) => dataError(code, message);

function entry(n: number): AuditEntryView {
  return {
    id: `0199f0a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
    at: '2026-10-23T06:52:11.123456Z',
    actor: { kind: 'system' },
    action: 'workspace.restored',
    target: { type: 'workspace' },
    params: {},
    changes: [],
  };
}

/** A fake read answered by hand: each call waits until the test settles it. */
function fakeList() {
  const calls: {
    readonly input: AuditListInput;
    readonly signal: AbortSignal;
    readonly answer: (page: AuditPage) => void;
    readonly fail: (error: unknown) => void;
  }[] = [];
  const list = (input: AuditListInput, signal: AbortSignal) =>
    new Promise<AuditPage>((resolve, reject) => {
      calls.push({ input, signal, answer: resolve, fail: reject });
    });
  const call = (index: number) => {
    const found = calls[index];
    if (found === undefined) throw new Error(`No call ${String(index)}.`);
    return found;
  };
  return { list, calls, call };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const statusOf = (state: AuditLogState) => state.status;

describe('openAuditLog', () => {
  it('reads the first page at once, then the next with its cursor', async () => {
    const api = fakeList();
    const log = openAuditLog({ list: api.list }, 'acme');
    const seen: string[] = [];
    log.subscribe(() => seen.push(statusOf(log.getSnapshot())));
    expect(log.getSnapshot()).toEqual({ status: 'loading', entries: [], hasMore: false });
    expect(api.call(0).input).toEqual({ workspace: 'acme' });

    api.call(0).answer({ entries: [entry(1), entry(2)], nextCursor: 'c1' });
    await settle();
    expect(log.getSnapshot()).toEqual({ status: 'ready', entries: [entry(1), entry(2)], hasMore: true });

    log.more();
    expect(api.call(1).input).toEqual({ workspace: 'acme', cursor: 'c1' });
    expect(log.getSnapshot()).toMatchObject({ status: 'more', entries: [entry(1), entry(2)] });
    // Show more again while a page is out asks nothing more.
    log.more();
    expect(api.calls).toHaveLength(2);
    api.call(1).answer({ entries: [entry(3)] });
    await settle();
    expect(log.getSnapshot()).toEqual({ status: 'ready', entries: [entry(1), entry(2), entry(3)], hasMore: false });
    // The last page: nothing follows.
    log.more();
    expect(api.calls).toHaveLength(2);
    expect(seen).toEqual(['ready', 'more', 'ready']);
  });

  it('keeps the rows when a later page fails, and Try again reads that page', async () => {
    const api = fakeList();
    const log = openAuditLog({ list: api.list }, 'acme');
    api.call(0).answer({ entries: [entry(1)], nextCursor: 'c1' });
    await settle();
    log.more();
    api.call(1).fail(failure('INTERNAL', 'Something went wrong on our side.'));
    await settle();
    expect(log.getSnapshot()).toEqual({
      status: 'more-failed',
      entries: [entry(1)],
      hasMore: true,
      message: 'Something went wrong on our side.',
    });
    log.retry();
    expect(api.call(2).input).toEqual({ workspace: 'acme', cursor: 'c1' });
    api.call(2).answer({ entries: [entry(2)] });
    await settle();
    expect(log.getSnapshot()).toEqual({ status: 'ready', entries: [entry(1), entry(2)], hasMore: false });
  });

  it('says a failed first page with the layer’s message, and Try again reads it from the top', async () => {
    const api = fakeList();
    const log = openAuditLog({ list: api.list }, 'acme');
    api.call(0).fail(failure('API_UNAVAILABLE', 'We can’t reach the server.'));
    await settle();
    expect(log.getSnapshot()).toEqual({
      status: 'failed',
      entries: [],
      hasMore: false,
      message: 'We can’t reach the server.',
    });
    // Show more does nothing from here.
    log.more();
    expect(api.calls).toHaveLength(1);
    log.retry();
    expect(log.getSnapshot().status).toBe('loading');
    expect(api.call(1).input).toEqual({ workspace: 'acme' });
    api.call(1).answer({ entries: [] });
    await settle();
    expect(log.getSnapshot()).toEqual({ status: 'ready', entries: [], hasMore: false });
  });

  it('turns a 403 on any page into forbidden, dropping the rows', async () => {
    const api = fakeList();
    const log = openAuditLog({ list: api.list }, 'acme');
    api.call(0).answer({ entries: [entry(1)], nextCursor: 'c1' });
    await settle();
    log.more();
    api.call(1).fail(failure('FORBIDDEN', 'Only workspace owners and admins can see workspace changes.'));
    await settle();
    expect(log.getSnapshot()).toEqual({
      status: 'forbidden',
      entries: [],
      hasMore: false,
      message: 'Only workspace owners and admins can see workspace changes.',
    });
    log.retry();
    log.more();
    expect(api.calls).toHaveLength(2);
  });

  it('aborts the read still out on dispose, and lands nothing after', async () => {
    const api = fakeList();
    const log = openAuditLog({ list: api.list }, 'acme');
    let heard = 0;
    log.subscribe(() => {
      heard += 1;
    });
    log.dispose();
    expect(api.call(0).signal.aborted).toBe(true);
    api.call(0).answer({ entries: [entry(1)] });
    await settle();
    expect(heard).toBe(0);
    expect(log.getSnapshot().status).toBe('loading');
    log.retry();
    log.more();
    expect(api.calls).toHaveLength(1);
  });

  it('disposes once its last holder lets go, unless held again first (a remount)', async () => {
    const api = fakeList();
    const log = openAuditLog({ list: api.list }, 'acme');
    const release = log.retain();
    release();
    const again = log.retain();
    await settle();
    expect(api.call(0).signal.aborted).toBe(false);
    again();
    // Letting go twice counts once.
    again();
    await settle();
    expect(api.call(0).signal.aborted).toBe(true);
  });

  it('says when a screen first holds it and when it is disposed, so the layer can hand the held log back', async () => {
    const api = fakeList();
    const heard: string[] = [];
    const log = openAuditLog(
      { list: api.list, onHeld: () => heard.push('held'), onDisposed: () => heard.push('disposed') },
      'acme',
    );
    const first = log.retain();
    const second = log.retain();
    expect(heard).toEqual(['held']);
    first();
    second();
    await settle();
    expect(heard).toEqual(['held', 'disposed']);
    // Disposed is final: held again, it says nothing more.
    log.retain();
    log.dispose();
    expect(heard).toEqual(['held', 'disposed']);
  });
});
