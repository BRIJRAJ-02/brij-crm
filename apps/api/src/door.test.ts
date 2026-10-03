// The access door in the API (spec 0005, AC-32): every procedure outside the
// bootstrap list is built on `member`, a member handler sees its scope and no
// raw database, the door refuses everyone but an active member the same way,
// and nothing in this app builds an engine scope.
import { readdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contract } from '@crm/contracts';
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { type AnyRouter, isProcedure, os, type RouterClient } from '@orpc/server';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import * as z from 'zod';
import { rpcClient, signIn, signInApp, testConnections } from '../test/sign-in.ts';
import { authed, member, pub, type RequestContext, requireMember, requireSession } from './orpc.ts';
import { router } from './router.ts';
import { APP_URL } from './testing.ts';

/** The procedures that run before a workspace is chosen (spec 0005), by name; every other one passes the door. */
const BOOTSTRAP: ReadonlySet<string> = new Set(['system.status', 'me.get', 'workspaces.create']);

function isBootstrap(path: string): boolean {
  return BOOTSTRAP.has(path);
}

/**
 * The module files holding the bootstrap handlers that read the database
 * without a member scope: `system.status` (a health read) and
 * `workspaces.create` (the engine's bootstrap). No other module file may.
 */
const RAW_DATABASE_FILES: ReadonlySet<string> = new Set(['system/router.ts', 'workspaces/router.ts']);

/** Reaching the database around the door: the raw pool from the context, or a workspace transaction of its own. */
const AROUND_THE_DOOR =
  /\bcontext\s*\.\s*db\b|\bcontext\s*:\s*\{[^}]*\bdb\b|\{[^}]*\bdb\b[^}]*\}\s*=\s*context\b|\bwithWorkspace\b/;

/** The module files (relative to src/modules) that reach the database around the door. */
function aroundTheDoor(files: readonly { readonly path: string; readonly source: string }[]): string[] {
  return files
    .filter(({ path, source }) => !RAW_DATABASE_FILES.has(path) && AROUND_THE_DOOR.test(source))
    .map(({ path }) => path);
}

/** Every procedure in a router (or a contract), by its dotted path. */
function procedures(tree: unknown, prefix: readonly string[] = []): [string, unknown][] {
  if (isProcedure(tree) || (typeof tree === 'object' && tree !== null && '~orpc' in tree && prefix.length > 0)) {
    return [[prefix.join('.'), tree]];
  }
  if (typeof tree !== 'object' || tree === null) return [];
  return Object.entries(tree).flatMap(([key, value]) => procedures(value, [...prefix, key]));
}

function middlewaresOf(procedure: unknown): readonly unknown[] {
  return isProcedure(procedure) ? procedure['~orpc'].middlewares : [];
}

/** The procedures outside the bootstrap list that skip the member door. */
function offTheDoor(tree: AnyRouter): string[] {
  return procedures(tree)
    .filter(([path, procedure]) => !isBootstrap(path) && !middlewaresOf(procedure).includes(requireMember))
    .map(([path]) => path);
}

describe('the contract walk', () => {
  it('finds every contract procedure implemented, and every one outside the bootstrap list behind the door', () => {
    const declared = procedures(contract).map(([path]) => path);
    const served = procedures(router).map(([path]) => path);
    expect(served.sort()).toEqual(declared.sort());
    expect(served.length).toBeGreaterThan(0);
    expect(offTheDoor(router)).toEqual([]);
  });

  it('fails a procedure outside the bootstrap list built on pub or authed, and passes one built on member', () => {
    const t = os.$context<RequestContext>();
    const sneaky = {
      records: {
        list: t.handler(() => 'open to anyone'),
        count: t.use(requireSession).handler(() => 'any signed in person'),
        get: t
          .use(requireSession)
          .use(requireMember)
          .handler(() => 'members only'),
      },
      system: { status: t.handler(() => 'bootstrap') },
    };
    expect(offTheDoor(sneaky).sort()).toEqual(['records.count', 'records.list']);
  });

  it('builds the three bases on the expected middlewares', () => {
    const procedure = (base: typeof pub | typeof authed | typeof member) =>
      base.me.get.handler(() => ({
        user: { id: '', name: '', email: '' },
        workspaces: [],
      }));
    expect(middlewaresOf(procedure(pub))).toEqual([]);
    expect(middlewaresOf(procedure(authed))).toEqual([requireSession]);
    expect(middlewaresOf(procedure(member))).toEqual([requireSession, requireMember]);
  });
});

describe('the door is the only way in', () => {
  it('types a member handler with no database: it reads through `context.scope`', () => {
    const t = os.$context<RequestContext>();
    const procedure = t
      .use(requireSession)
      .use(requireMember)
      .handler(({ context }) => {
        const scoped: string = context.scope.workspaceId;
        // @ts-expect-error A member handler has no `db` to query around the door.
        const raw: unknown = context.db.withWorkspace;
        return { scoped, raw };
      });
    expect(middlewaresOf(procedure)).toEqual([requireSession, requireMember]);
  });

  it('finds no module reaching the database around the door, outside the named bootstrap handlers', async () => {
    const root = fileURLToPath(new URL('./modules/', import.meta.url));
    const files = await Promise.all(
      (await readdir(root, { recursive: true }))
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
        .map(async (path) => ({ path: path.split(sep).join('/'), source: await readFile(join(root, path), 'utf8') })),
    );
    expect(files.map((file) => file.path)).toEqual(expect.arrayContaining([...RAW_DATABASE_FILES]));
    expect(aroundTheDoor(files)).toEqual([]);
  });

  it('catches a module that does (the check works)', () => {
    const handler = (body: string) =>
      `export const r = member.records.router({ list: member.records.list.handler(${body}) });`;
    expect(
      aroundTheDoor([
        { path: 'records/router.ts', source: handler('({ context }) => context.db.withWorkspace(id, read)') },
        { path: 'lists/router.ts', source: handler('({ context: { db } }) => list(db)') },
        { path: 'notes/router.ts', source: handler('({ context }) => { const { db, identity } = context; }') },
        { path: 'tasks/router.ts', source: handler('({ context }) => withWorkspace(context.scope.workspaceId)') },
        { path: 'deals/router.ts', source: handler('({ context }) => readDeals(context.scope)') },
        { path: 'system/router.ts', source: handler('({ context }) => status({ db: context.db })') },
      ]),
    ).toEqual(['records/router.ts', 'lists/router.ts', 'notes/router.ts', 'tasks/router.ts']);
  });
});

describe('no scope is built in this app', () => {
  it('names no EngineScope, system actor or actor literal in any source file', async () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files = (await readdir(root, { recursive: true }))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => join(root, file));
    expect(files.length).toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (/\bEngineScope\b|\bSYSTEM_ACTOR\b|\bactor\s*:/.test(source)) offenders.push(file.slice(root.length));
    }
    expect(offenders).toEqual([]);
  });
});

describe('the member door', () => {
  const { ownerUrl } = inject('testDatabase');
  let db: Database;
  let identity: IdentityStore;

  // A workspace procedure, as milestone 2's will be: it answers which workspace and member the door let in.
  const t = os.$context<RequestContext>();
  const probeRouter = {
    probe: t
      .use(requireSession)
      .use(requireMember)
      .input(z.object({ workspace: z.string() }))
      .handler(({ context }) => ({
        workspaceId: context.scope.workspaceId,
        memberId: context.scope.actor.id,
        // What the handler holds besides its scope: the raw pool must not be among it.
        raw: (context as Record<string, unknown>).db ?? null,
      })),
  };
  let app: ReturnType<typeof signInApp>['app'];
  let probe: (cookie: string | undefined, workspace: unknown) => Promise<unknown>;

  beforeAll(() => {
    ({ db, identity } = testConnections());
    ({ app } = signInApp({ db, identity }, {}, { router: probeRouter }));
    const client = (cookie: string | undefined): RouterClient<typeof probeRouter> =>
      createORPCClient(
        new RPCLink({
          url: `${APP_URL}/api/rpc`,
          headers: { origin: APP_URL, ...(cookie === undefined ? {} : { cookie }) },
          fetch: async (request) => app.fetch(request),
        }),
      );
    probe = (cookie, workspace) => client(cookie).probe({ workspace } as { workspace: string });
  });
  afterAll(async () => {
    await identity.close();
    await db.close();
  });

  /** A signed in person with their own workspace, made through the real procedure. */
  async function memberWithWorkspace() {
    const appWithContract = signInApp({ db, identity }).app;
    const { cookie } = await signIn(appWithContract);
    const slug = `door-${newId().slice(-8)}`;
    const { workspace } = await rpcClient(appWithContract, cookie).workspaces.create({
      id: newId(),
      name: 'Door',
      slug,
      memberName: 'Ada',
    });
    return { cookie, workspace };
  }

  async function failure(call: () => Promise<unknown>): Promise<ORPCError<string, unknown>> {
    try {
      await call();
    } catch (error) {
      if (error instanceof ORPCError) return error;
      throw error;
    }
    throw new Error('The door let it through.');
  }

  async function refusal(call: () => Promise<unknown>) {
    const { code, status, message } = await failure(call);
    return { code, status, message };
  }

  it('lets an active member into their workspace, as their member row', async () => {
    const a = await memberWithWorkspace();
    const members = await testQuery<{ id: string }>(ownerUrl, 'select id from members where workspace_id = $1', [
      a.workspace.id,
    ]);
    expect(await probe(a.cookie, a.workspace.slug)).toEqual({
      workspaceId: a.workspace.id,
      memberId: members[0]?.id,
      raw: null,
    });
  });

  it("refuses another workspace's member, a removed member and an unknown address the same way", async () => {
    const a = await memberWithWorkspace();
    const b = await memberWithWorkspace();
    const notFound = {
      code: 'NOT_FOUND',
      status: 404,
      message: "That workspace doesn't exist, or you're not a member of it.",
    };

    expect(await refusal(() => probe(b.cookie, a.workspace.slug))).toEqual(notFound);
    expect(await refusal(() => probe(a.cookie, `nowhere-${newId().slice(-8)}`))).toEqual(notFound);

    await testQuery(ownerUrl, `update members set status = 'removed' where workspace_id = $1`, [a.workspace.id]);
    expect(await refusal(() => probe(a.cookie, a.workspace.slug))).toEqual(notFound);
  });

  it('refuses no session with 401 before the door is reached, and a missing address as bad input', async () => {
    const a = await memberWithWorkspace();
    expect(await refusal(() => probe(undefined, a.workspace.slug))).toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
    expect(await refusal(() => probe(a.cookie, undefined))).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
  });
});
