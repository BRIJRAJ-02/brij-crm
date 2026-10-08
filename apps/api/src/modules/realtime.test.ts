// realtime.* (spec 0005): the connection token needs a session, the
// subscription token the member door, and the real Centrifugo (compose and CI)
// lets a browser holding both listen to its own workspace's channel.
import { randomUUID } from 'node:crypto';
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { ORPCError } from '@orpc/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { LOCAL_CENTRIFUGO_TOKEN_SECRET } from '../env.ts';

const WS_URL = 'ws://localhost:8000/connection/websocket';

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
let off: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }, { CENTRIFUGO_TOKEN_SECRET: LOCAL_CENTRIFUGO_TOKEN_SECRET }));
  ({ app: off } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

async function failure(call: () => Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ORPCError) return error;
    throw error;
  }
  throw new Error('The call succeeded.');
}

/** A signed in person with their own workspace. */
async function memberWithWorkspace(on = app) {
  const { cookie } = await signIn(on);
  const client = rpcClient(on, cookie);
  const { workspace } = await client.workspaces.create({
    id: newId(),
    name: 'Acme',
    slug: `live-${randomUUID().slice(0, 8)}`,
    memberName: 'Ada',
  });
  return { client, workspace };
}

/** Connects to Centrifugo with `token`, subscribes to `channel` with `subscription`, and answers both replies. */
async function centrifugo(token: string, channel: string, subscription: string) {
  const socket = new WebSocket(WS_URL);
  const replies = new Map<number, (reply: Record<string, unknown>) => void>();
  socket.addEventListener('message', (event) => {
    for (const line of String(event.data).split('\n').filter(Boolean)) {
      const reply = JSON.parse(line) as Record<string, unknown> & { id?: number };
      if (reply.id !== undefined) replies.get(reply.id)?.(reply);
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error(`Centrifugo isn't answering at ${WS_URL}.`)));
  });
  const call = (id: number, command: Record<string, unknown>) => {
    const reply = new Promise<Record<string, unknown>>((resolve) => replies.set(id, resolve));
    socket.send(JSON.stringify({ id, ...command }));
    return reply;
  };
  try {
    const connected = await call(1, { connect: { token } });
    const subscribed = await call(2, { subscribe: { channel, token: subscription } });
    return { connected, subscribed };
  } finally {
    socket.close();
  }
}

describe('realtime tokens', () => {
  it('lets a member connect and listen to their own workspace channel', async () => {
    const { client, workspace } = await memberWithWorkspace();
    const { token } = await client.realtime.connectionToken();
    const subscription = await client.realtime.subscriptionToken({ workspace: workspace.slug });
    expect(subscription.channel).toBe(`workspace:${workspace.id}`);

    const replies = await centrifugo(token, subscription.channel, subscription.token);
    expect(replies.connected).toHaveProperty('connect');
    expect(replies.subscribed).toMatchObject({ subscribe: { recoverable: true } });
  });

  it("refuses a subscription token for someone else's workspace with the door's NOT_FOUND", async () => {
    const { workspace } = await memberWithWorkspace();
    const { cookie } = await signIn(app);
    const stranger = rpcClient(app, cookie);
    expect(await failure(() => stranger.realtime.subscriptionToken({ workspace: workspace.slug }))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('refuses both without a session', async () => {
    const { workspace } = await memberWithWorkspace();
    const anonymous = rpcClient(app);
    expect(await failure(() => anonymous.realtime.connectionToken())).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await failure(() => anonymous.realtime.subscriptionToken({ workspace: workspace.slug }))).toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('answers 503 API_UNAVAILABLE where live updates are off (no token secret)', async () => {
    const { client, workspace } = await memberWithWorkspace(off);
    expect(await failure(() => client.realtime.connectionToken())).toMatchObject({
      code: 'API_UNAVAILABLE',
      status: 503,
    });
    expect(await failure(() => client.realtime.subscriptionToken({ workspace: workspace.slug }))).toMatchObject({
      code: 'API_UNAVAILABLE',
    });
  });
});
