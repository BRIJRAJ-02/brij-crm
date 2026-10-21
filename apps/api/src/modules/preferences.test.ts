// Settings › Account › Preferences in the API: the caller's own, behind the
// member door. A non member gets the door's NOT_FOUND, a bad value the
// standard refusal, a landing object from another workspace reads as unknown,
// and nobody reads another member's.
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace, NOT_A_MEMBER, refusal } from '../../test/workspace.ts';

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

describe('preferences', () => {
  it('reads the defaults, then keeps a change', async () => {
    const m = await memberWithWorkspace(app);
    expect(await m.client.preferences.get({ workspace: m.slug })).toEqual({
      dateFormat: 'auto',
      weekStart: 'auto',
      landing: { kind: 'home' },
    });
    await m.client.preferences.update({
      workspace: m.slug,
      timeZone: 'Europe/Berlin',
      landing: { kind: 'object', objectId: m.people.id },
      mutationId: newId(),
    });
    expect(await m.client.preferences.get({ workspace: m.slug })).toEqual({
      timeZone: 'Europe/Berlin',
      dateFormat: 'auto',
      weekStart: 'auto',
      landing: { kind: 'object', objectId: m.people.id },
    });
  });

  it('answers a non member as the door does, and reads nothing of another workspace', async () => {
    const m = await memberWithWorkspace(app);
    const other = await memberWithWorkspace(app);
    await other.client.preferences.update({ workspace: other.slug, weekStart: 'sunday', mutationId: newId() });
    const { cookie } = await signIn(app);
    const stranger = rpcClient(app, cookie);
    expect(await refusal(() => stranger.preferences.get({ workspace: m.slug }))).toEqual(NOT_A_MEMBER);
    expect(
      await refusal(() => stranger.preferences.update({ workspace: m.slug, weekStart: 'monday', mutationId: newId() })),
    ).toEqual(NOT_A_MEMBER);
    // Another workspace's member is a stranger here too; their own change stays theirs.
    expect(await refusal(() => other.client.preferences.get({ workspace: m.slug }))).toEqual(NOT_A_MEMBER);
    expect((await m.client.preferences.get({ workspace: m.slug })).weekStart).toBe('auto');
    // A landing object from the other workspace reads as unknown.
    const crossed = await failure(() =>
      m.client.preferences.update({
        workspace: m.slug,
        landing: { kind: 'object', objectId: other.people.id },
        mutationId: newId(),
      }),
    );
    expect(crossed.code).toBe('NOT_FOUND');
  });

  it('refuses a value outside the lists', async () => {
    const m = await memberWithWorkspace(app);
    const bad = await failure(() =>
      m.client.preferences.update({ workspace: m.slug, timeZone: 'Mars/Olympus', mutationId: newId() }),
    );
    expect(bad.status).toBe(400);
  });
});
