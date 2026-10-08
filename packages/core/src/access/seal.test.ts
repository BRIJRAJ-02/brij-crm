// The sealed scope and the one runner (spec 0009, AC-137, AC-138), against a
// real Postgres as the app role: only a scope the door minted reaches the
// database, the last owner guard's commit refusal answers LAST_OWNER through
// both ways in, and the relay's audiences come from the members' roles.
import { readdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { listAttributes } from '../engine/definitions.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { testScope } from '../testing.ts';
import { audiences } from './audiences.ts';
import { systemScope } from './door.ts';
import type { EngineScope } from './mint.ts';
import { inWorkspace } from './run.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-seal-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Seal',
    slug: `seal-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  return { ...created, scope, people: created.objects.people ?? '' };
}

const FORGED = /did not make/;

describe('the seal (AC-138)', () => {
  it('lets a minted scope through', async () => {
    const { scope, people } = await workspace();
    expect((await listAttributes(scope, people)).length).toBeGreaterThan(0);
  });

  it('refuses an object literal, a spread copy, a prototype override and an unfrozen copy, in reads and writes', async () => {
    const a = await workspace();
    const b = await workspace();
    const literal = {
      db,
      workspaceId: b.workspaceId,
      actor: a.scope.actor,
      access: a.scope.access,
    } as unknown as EngineScope;
    const spread = { ...a.scope, workspaceId: b.workspaceId };
    const overridden = Object.create(a.scope, { workspaceId: { value: b.workspaceId } }) as EngineScope;
    const unfrozen = Object.defineProperties({}, Object.getOwnPropertyDescriptors(a.scope)) as EngineScope;
    const sameFieldsCopy = Object.freeze(
      Object.defineProperties(
        {},
        { ...Object.getOwnPropertyDescriptors(a.scope), workspaceId: { value: b.workspaceId } },
      ),
    ) as EngineScope;
    for (const forged of [literal, spread, overridden, unfrozen, sameFieldsCopy]) {
      await expect(listAttributes(forged, b.people)).rejects.toThrow(FORGED);
      await expect(runWrite(forged, () => Promise.resolve('wrote'))).rejects.toThrow(FORGED);
    }
  });

  it('keeps a minted scope frozen', async () => {
    const { scope } = await workspace();
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.actor)).toBe(true);
    expect(Object.keys(scope).sort()).toEqual(['access', 'actor', 'db', 'workspaceId']);
  });
});

describe('the last owner at commit (AC-137)', () => {
  const LAST_OWNER = {
    code: 'LAST_OWNER',
    message: 'A workspace needs an owner. Make someone else an owner first.',
  };

  async function refusalOf(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      if (isRefusal(error)) return error.refusal;
      throw error;
    }
    throw new Error('Expected a refusal.');
  }

  it('maps a raw update that leaves no owner to LAST_OWNER, through inWorkspace and through runWrite', async () => {
    const { scope, memberId } = await workspace();
    const demote = sql`update members set role = 'member' where id = ${memberId}`;
    expect(await refusalOf(inWorkspace(scope, (tx) => tx.execute(demote)))).toEqual(LAST_OWNER);
    expect(await refusalOf(runWrite(scope, ({ tx }) => tx.execute(demote)))).toEqual(LAST_OWNER);
    const removal = sql`update members set status = 'removed' where id = ${memberId}`;
    expect(await refusalOf(inWorkspace(scope, (tx) => tx.execute(removal)))).toEqual(LAST_OWNER);
    const [row] = await inWorkspace(scope, (tx) =>
      tx.execute<{ role: string; status: string }>(sql`select role, status from members where id = ${memberId}`),
    ).then((result) => result.rows);
    expect(row).toEqual({ role: 'owner', status: 'active' });
  });

  it('leaves any other failure unexpected', async () => {
    const { scope } = await workspace();
    const error = await inWorkspace(scope, (tx) => tx.execute(sql`select 1 / 0`)).catch((caught: unknown) => caught);
    expect(isRefusal(error)).toBe(false);
  });
});

describe('audiences', () => {
  it('groups the active members into the one open audience, with their permissions, for the system only', async () => {
    const { workspaceId, memberId, scope } = await workspace();
    const groups = await audiences(systemScope(db, workspaceId));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('open');
    expect(groups[0]?.members).toEqual([{ memberId, permissions: scope.access.permissions }]);
    await expect(audiences(scope)).rejects.toThrow(/Only the system/);
  });
});

describe('the one runner (AC-138)', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));

  async function sources() {
    const files = (await readdir(root, { recursive: true })).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );
    return Promise.all(
      files.map(async (file) => ({
        path: file.split(sep).join('/'),
        source: await readFile(join(root, file), 'utf8'),
      })),
    );
  }

  it('reads scope.db nowhere in packages/core but the runner, the seal and the testing entry', async () => {
    const offenders = (await sources())
      .filter(
        ({ path, source }) =>
          !['access/run.ts', 'access/mint.ts', 'testing.ts'].includes(path) &&
          /\bscope\s*\.\s*db\b|\{[^}]*\bdb\b[^}]*\}\s*=\s*scope\b/.test(source),
      )
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('mints scopes only in the door and the testing entry', async () => {
    const offenders = (await sources())
      .filter(
        ({ path, source }) =>
          !['access/mint.ts', 'access/door.ts', 'testing.ts'].includes(path) && /\bmintScope\b/.test(source),
      )
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('imports the system and testing entries from nowhere in the package’s own code', async () => {
    const offenders = (await sources())
      .filter(({ source }) => /from\s+'[./]*(system|testing)\.ts'/.test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
