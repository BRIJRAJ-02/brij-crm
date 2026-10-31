// The access door in the API (spec 0005, AC-32): every procedure outside the
// bootstrap list is built on `member`, a member handler sees its scope and
// neither the raw database nor the identity store, the door refuses everyone but an active member the same way,
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
import {
  authed,
  member,
  operator,
  pub,
  type RequestContext,
  requireMember,
  requireOperator,
  requireSession,
} from './orpc.ts';
import { router } from './router.ts';
import { APP_URL } from './testing.ts';

/** The procedures that run before a workspace is chosen (spec 0005), by name; every other one passes the door. */
const BOOTSTRAP: ReadonlySet<string> = new Set([
  'system.status',
  'system.testFault',
  'me.get',
  // Spec 0031: passes the door inside packages/core before it writes the caller's own preference.
  'me.setLastWorkspace',
  // Spec 0031: an invitation's token finds its workspace in packages/core, which mints the scope there.
  'invitations.peek',
  'invitations.accept',
  // Spec 0031, slice 6: the signed in person's own workspaces to ask, found in packages/core by their email's
  // domain, which mints a scope in each.
  'join.list',
  'join.request',
  // Spec 0031, slice 7: a deleted workspace's owners, whose scope `enterDeletedWorkspace` mints in packages/core.
  'deletedWorkspace.deleted',
  'deletedWorkspace.restore',
  'workspaces.create',
  'workspaces.slugAvailable',
  'realtime.connectionToken',
  // The signed in person's own sessions (spec 0033): global identity, by their user id, before any workspace.
  'account.sessions.list',
  'account.sessions.revoke',
  'account.sessions.revokeOthers',
  'account.security.get',
  // The signed in person's own sign in activity (spec 0033, AC-898): their security events, by their user id.
  'account.activity.list',
  'account.stepUp.start',
  'account.stepUp.verify',
  'account.deletion.check',
  'account.deletion.confirm',
]);

function isBootstrap(path: string): boolean {
  return BOOTSTRAP.has(path);
}

/**
 * The module files holding the bootstrap handlers that read the database
 * without a member scope: `system.status` (a health read) and
 * `workspaces.create` (the engine's bootstrap), `me.setLastWorkspace`
 * (spec 0031), whose service passes the door in packages/core, and
 * `invitations.peek` and `.accept` (spec 0031), whose services find the
 * workspace by the token's hash. No other module file may.
 */
const RAW_DATABASE_FILES: ReadonlySet<string> = new Set([
  // The operator console (spec 0047): crm_operator's definers, behind the operator gate, never a member scope.
  'operator/router.ts',
  'system/router.ts',
  'workspaces/router.ts',
  'me/router.ts',
  'invitations/public.ts',
  'join/router.ts',
]);

/**
 * The module files holding the bootstrap handlers that read global identity:
 * `me.get`, `workspaces.create` and `workspaces.slugAvailable`, and
 * `invitations.peek` (its per address limit, spec 0031), and the account
 * procedures (spec 0033). No other module file may.
 */
const RAW_IDENTITY_FILES: ReadonlySet<string> = new Set([
  // The operator console (spec 0047): people and the website's visits, behind the operator gate.
  'operator/router.ts',
  'me/router.ts',
  'workspaces/router.ts',
  'invitations/public.ts',
  'account/router.ts',
]);

/** Reaching the database around the door: the raw pool from the context, or a workspace transaction of its own. */
const AROUND_THE_DOOR =
  /\bcontext\s*\.\s*db\b|\bcontext\s*:\s*\{[^}]*\bdb\b|\{[^}]*\bdb\b[^}]*\}\s*=\s*context\b|\bwithWorkspace\b/;

/** Reaching global identity (sessions, the directory, every user) from the context. */
const IDENTITY_FROM_CONTEXT =
  /\bcontext\s*\.\s*identity\b|\bcontext\s*:\s*\{[^}]*\bidentity\b|\{[^}]*\bidentity\b[^}]*\}\s*=\s*context\b/;

/**
 * The directory's one write a member handler holds (spec 0031): dropping a
 * removed person's switcher entry. Only the members module may reach it, and
 * only with ids its own removal answered.
 */
const DIRECTORY_FROM_CONTEXT =
  /\bcontext\s*\.\s*directory\b|\bdirectory\b[^}]*\}\s*=\s*context\b|\bcontext\s*:\s*\{[^}]*\bdirectory\b|\bcontext\s*\[\s*['"]directory/;

/** The module files allowed the directory's write. */
const DIRECTORY_FILES: ReadonlySet<string> = new Set([
  'members/router.ts',
  // Slice 7: a workspace's renamed label and deleted mark, after the tenant change commits.
  'workspace/router.ts',
  'workspace/deleted.ts',
]);

/** Importing system power or hand made scopes (spec 0009): no module file may, not even a bootstrap one. */
const CORE_ENTRIES = /from\s+['"]@crm\/core\/(system|testing)['"]/;

/** The module files (relative to src/modules) that reach the database or global identity around the door. */
function aroundTheDoor(files: readonly { readonly path: string; readonly source: string }[]): string[] {
  return files
    .filter(
      ({ path, source }) =>
        (!RAW_DATABASE_FILES.has(path) && AROUND_THE_DOOR.test(source)) ||
        (!RAW_IDENTITY_FILES.has(path) && IDENTITY_FROM_CONTEXT.test(source)) ||
        (!DIRECTORY_FILES.has(path) && DIRECTORY_FROM_CONTEXT.test(source)) ||
        CORE_ENTRIES.test(source),
    )
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

/**
 * The procedures outside the bootstrap list that skip the member door. The
 * operator console's (spec 0047) pass the operator gate instead, and only
 * they may: a procedure under `operator` without it is off the door too.
 */
function offTheDoor(tree: AnyRouter): string[] {
  return procedures(tree)
    .filter(([path, procedure]) => {
      if (isBootstrap(path)) return false;
      const middlewares = middlewaresOf(procedure);
      if (path.startsWith('operator.')) return !middlewares.includes(requireOperator);
      return !middlewares.includes(requireMember);
    })
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
      operator: {
        overview: t
          .use(requireSession)
          .use(requireOperator)
          .handler(() => 'super admins only'),
        users: t.use(requireSession).handler(() => 'any signed in person'),
      },
    };
    expect(offTheDoor(sneaky).sort()).toEqual(['operator.users', 'records.count', 'records.list']);
  });

  it('builds the three bases on the expected middlewares', () => {
    const procedure = (base: typeof pub | typeof authed | typeof member) =>
      base.me.get.handler(() => ({
        user: { id: '', name: '', email: '' },
        workspaces: [],
        isOperator: false,
      }));
    expect(middlewaresOf(procedure(pub))).toEqual([]);
    expect(middlewaresOf(procedure(authed))).toEqual([requireSession]);
    expect(middlewaresOf(procedure(member))).toEqual([requireSession, requireMember]);
    expect(middlewaresOf(procedure(operator))).toEqual([requireSession, requireOperator]);
  });
});

describe('the door is the only way in', () => {
  it('types a member handler with no database and no identity store: it reads through `context.scope`', () => {
    const t = os.$context<RequestContext>();
    const procedure = t
      .use(requireSession)
      .use(requireMember)
      .handler(({ context }) => {
        const scoped: string = context.scope.workspaceId;
        // @ts-expect-error A member handler has no `db` to query around the door.
        const raw: unknown = context.db.withWorkspace;
        // @ts-expect-error Nor global identity: sessions, the directory and every user are no member handler's.
        const users: unknown = context.identity.getUser;
        return { scoped, raw, users };
      });
    expect(middlewaresOf(procedure)).toEqual([requireSession, requireMember]);
  });

  it('finds no module reaching the database or identity around the door, outside the named bootstrap handlers', async () => {
    const root = fileURLToPath(new URL('./modules/', import.meta.url));
    const files = await Promise.all(
      (await readdir(root, { recursive: true }))
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
        .map(async (path) => ({ path: path.split(sep).join('/'), source: await readFile(join(root, path), 'utf8') })),
    );
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([...RAW_DATABASE_FILES, ...RAW_IDENTITY_FILES]),
    );
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
        { path: 'calls/router.ts', source: handler('({ context }) => context.directory.dropMembership(a, b)') },
        { path: 'notes2/router.ts', source: handler('({ context: { directory } }) => directory.dropMembership(a, b)') },
        { path: 'tasks/router.ts', source: handler('({ context }) => withWorkspace(context.scope.workspaceId)') },
        { path: 'deals/router.ts', source: handler('({ context }) => readDeals(context.scope)') },
        { path: 'system/router.ts', source: handler('({ context }) => status({ db: context.db })') },
        { path: 'people/router.ts', source: handler('({ context }) => context.identity.getUser(id)') },
        { path: 'teams/router.ts', source: handler('({ context: { identity } }) => identity.findWorkspace(slug)') },
        { path: 'tags/router.ts', source: handler('({ context }) => { const { identity } = context; }') },
        { path: 'me/router.ts', source: handler('({ context }) => getMe({ identity: context.identity })') },
        { path: 'system/router.ts', source: handler('({ context }) => who(context.identity)') },
        { path: 'jobs/router.ts', source: `import { systemScope } from '@crm/core/system';\n${handler('() => 1')}` },
        {
          path: 'workspaces/router.ts',
          source: `import { testScope } from "@crm/core/testing";\n${handler('() => 1')}`,
        },
      ]),
    ).toEqual([
      'records/router.ts',
      'lists/router.ts',
      'notes/router.ts',
      'calls/router.ts',
      'notes2/router.ts',
      'tasks/router.ts',
      'people/router.ts',
      'teams/router.ts',
      'tags/router.ts',
      'system/router.ts',
      'jobs/router.ts',
      'workspaces/router.ts',
    ]);
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

  it('imports system power only in the worker entry, its jobs and the relay, and test scopes nowhere (spec 0009)', async () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files = (await readdir(root, { recursive: true }))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => file.split(sep).join('/'));
    const allowed = (file: string) => file === 'worker.ts' || file.startsWith('jobs/') || file.startsWith('realtime/');
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(join(root, file), 'utf8');
      if (/from\s+['"]@crm\/core\/testing['"]/.test(source)) offenders.push(file);
      if (/from\s+['"]@crm\/core\/system['"]/.test(source) && !allowed(file)) offenders.push(file);
      // The system actor comes only from the system entry now, never the main one.
      if (/\bSYSTEM_ACTOR\b/.test(source) && !allowed(file)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('injects no rules outside tests: production reads the stored ones (specs 0009 and 0032, AC-841)', async () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    // Only the app passes the services' source on, the request context carries it to the door, the public API
    // (parity #34) hands the app's to the key's door, and the job runner hands its own to the worker's re-entry;
    // rules.ts names the one source, and the server and the worker pass it.
    const plumbing = new Set(['app.ts', 'orpc.ts', 'v1/rest.ts', 'testing.ts', 'jobs/runner.ts', 'rules.ts']);
    const PASSERS = new Set(['server.ts', 'worker.ts', 'vercel/handler.ts', 'jobs/compose.ts']);
    const files = (await readdir(root, { recursive: true }))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => file.split(sep).join('/'))
      .filter((file) => !plumbing.has(file));
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(join(root, file), 'utf8');
      // The attribute router passes an attribute's validation rules (spec 0013) on as `rules: input.rules`: not the
      // door's. That one form, in that one file, is let through.
      const checked =
        file === 'modules/attributes/router.ts' ? source.replaceAll(/\brules: input\.rules\b/g, '') : source;
      // The server, the worker, the Vercel Function (spec 0045) and the jobs they share hand on rules.ts's source,
      // the same one to all, and nothing else.
      const passed = PASSERS.has(file) ? checked.replaceAll(/\brules: APP_RULES\b/g, '') : checked;
      if (/\bRuleSource\b|\brules\s*[:,}]/.test(passed)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
    // That one source is the stored rules (spec 0032, AC-841): `NO_RULE_SOURCE` stays for tests only.
    expect(await readFile(join(root, 'rules.ts'), 'utf8')).toMatch(/export const APP_RULES: RuleSource = storedRules;/);
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
        // What the handler holds besides its scope: neither the raw pool nor the identity store is among it.
        raw: (context as Record<string, unknown>).db ?? null,
        identity: (context as Record<string, unknown>).identity ?? null,
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
      identity: null,
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

    // Another owner stays (no user), so the workspace keeps one (spec 0009, AC-137).
    await testQuery(
      ownerUrl,
      `insert into members (workspace_id, name, email, role, created_by_type, updated_by_type)
       values ($1, 'Keeper', 'keeper@example.com', 'owner', 'system', 'system')`,
      [a.workspace.id],
    );
    await testQuery(ownerUrl, `update members set status = 'removed' where workspace_id = $1 and user_id is not null`, [
      a.workspace.id,
    ]);
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
