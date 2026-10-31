// API keys (parity #34), the member door's part: list, make, revoke and bring back within the Undo window. All need
// `api_keys.manage`, and only a member makes one: a key is never wider than the member who made it (the door caps it
// on every request, `enterWithKey`). The whole key is answered once, by the create; only the SHA-256 of its secret
// and its last four characters are stored. Every change writes its audit row in the same transaction.
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { API_KEY_UNDO_SECONDS, API_KEYS_MAX, type ApiKey, type ApiKeyAccess, type ApiKeyList } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { canonicalId, isUuid, isUuidV7 } from '../engine/ids.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';
import { keyHint, keySecretHash, keyToken, newKeySecret } from './tokens.ts';

const { apiKeys } = schema;

type Row = typeof apiKeys.$inferSelect;

const UNKNOWN_KEY = 'That key does not exist.';
const FULL = `A workspace holds at most ${String(API_KEYS_MAX)} keys. Revoke one to make room.`;

/** The scopes each choice stores. */
const SCOPES: Readonly<Record<ApiKeyAccess, readonly string[]>> = {
  read: ['data.read'],
  write: ['data.read', 'data.write'],
};

/** The member the caller is, or a refusal: a key's access is capped by a person's. */
function me(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a member can make or revoke API keys.');
  return principal.memberId;
}

/** A row as the screen reads it: never the hash. */
function toView(row: Row): ApiKey {
  return {
    id: row.id,
    name: row.name,
    access: row.scopes.includes('data.write') ? 'write' : 'read',
    hint: row.hint,
    createdByMemberId: row.createdByMemberId,
    createdAt: new Date(row.createdAt).toISOString(),
    ...(row.lastUsedAt === null ? {} : { lastUsedAt: new Date(row.lastUsedAt).toISOString() }),
    ...(row.revokedAt === null ? {} : { revokedAt: new Date(row.revokedAt).toISOString() }),
  };
}

/** How many live keys the workspace holds, under a lock on the workspace's keys, so two creates can't pass 25. */
async function lockedCount(tx: WorkspaceTx, workspaceId: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`api_keys:${workspaceId}`}, 0))`);
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(isNull(apiKeys.revokedAt));
  return row?.n ?? 0;
}

/** The workspace's live keys, newest first. */
export async function listApiKeys(scope: EngineScope): Promise<ApiKeyList> {
  requirePermission(scope, 'api_keys.manage');
  const rows = await inWorkspace(scope, (tx) =>
    tx.select().from(apiKeys).where(isNull(apiKeys.revokedAt)).orderBy(desc(apiKeys.createdAt)).limit(API_KEYS_MAX),
  );
  return { keys: rows.map(toView), max: API_KEYS_MAX };
}

/**
 * Makes a key with the caller as its creator, and answers its whole value, once. The id is the browser's v7 id; one
 * already used is `ID_TAKEN` (a key's value can't be answered twice, so a lost answer means making another). The
 * 26th live key is `LIMIT_REACHED`. One `api_key.created` audit row.
 */
export async function createApiKey(
  scope: EngineScope,
  input: { readonly id: string; readonly name: string; readonly access: ApiKeyAccess },
  source: AuditSource = {},
): Promise<{ readonly key: ApiKey; readonly token: string }> {
  requirePermission(scope, 'api_keys.manage');
  const caller = me(scope);
  if (!isUuidV7(input.id)) throw refuseOn('CONFIG_INVALID', 'The key id must be a UUID v7.', 'id');
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) throw refuseOn('CONFIG_INVALID', 'Give the key a short name.', 'name');
  const id = canonicalId(input.id);
  const secret = newKeySecret();
  const key = await inWorkspace(scope, async (tx) => {
    const [existing] = await tx.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, id));
    if (existing !== undefined) throw refuse('ID_TAKEN', 'A key with that id already exists.');
    if ((await lockedCount(tx, scope.workspaceId)) >= API_KEYS_MAX) throw refuse('LIMIT_REACHED', FULL);
    const [row] = await tx
      .insert(apiKeys)
      .values({
        workspaceId: scope.workspaceId,
        id,
        name,
        scopes: [...SCOPES[input.access]],
        secretHash: keySecretHash(secret),
        hint: keyHint(secret),
        createdByMemberId: caller,
      })
      .returning();
    if (row === undefined) throw new Error('A key just written could not be read back.');
    await writeAudit(
      tx,
      scope.workspaceId,
      scope.actor,
      { action: 'api_key.created', targetType: 'workspace', targetId: scope.workspaceId, after: { name, keyId: id } },
      source,
    );
    return toView(row);
  });
  return { key, token: keyToken({ workspaceId: scope.workspaceId, keyId: id, secret }) };
}

/** Revokes a live key: it stops working at once. Revoking one already revoked answers it as it is. */
export async function revokeApiKey(
  scope: EngineScope,
  input: { readonly keyId: string },
  source: AuditSource = {},
): Promise<ApiKey> {
  requirePermission(scope, 'api_keys.manage');
  const caller = me(scope);
  if (!isUuid(input.keyId)) throw refuse('NOT_FOUND', UNKNOWN_KEY);
  return inWorkspace(scope, async (tx) => {
    const [row] = await tx.select().from(apiKeys).where(eq(apiKeys.id, input.keyId)).for('update');
    if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_KEY);
    if (row.revokedAt !== null) return toView(row);
    const [revoked] = await tx
      .update(apiKeys)
      .set({ revokedAt: sql`now()`, revokedByMemberId: caller })
      .where(eq(apiKeys.id, row.id))
      .returning();
    if (revoked === undefined) throw new Error('A key just revoked could not be read back.');
    await writeAudit(
      tx,
      scope.workspaceId,
      scope.actor,
      {
        action: 'api_key.revoked',
        targetType: 'workspace',
        targetId: scope.workspaceId,
        after: { name: row.name, keyId: row.id },
      },
      source,
    );
    return toView(revoked);
  });
}

/**
 * Brings a revoked key back within its Undo window (`API_KEY_UNDO_SECONDS`); past it the revoke is for good
 * (`NOT_FOUND`). A live key answers as it is. Counts toward the 25 again.
 */
export async function restoreApiKey(
  scope: EngineScope,
  input: { readonly keyId: string },
  source: AuditSource = {},
): Promise<ApiKey> {
  requirePermission(scope, 'api_keys.manage');
  me(scope);
  if (!isUuid(input.keyId)) throw refuse('NOT_FOUND', UNKNOWN_KEY);
  return inWorkspace(scope, async (tx) => {
    const [row] = await tx.select().from(apiKeys).where(eq(apiKeys.id, input.keyId)).for('update');
    if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_KEY);
    if (row.revokedAt === null) return toView(row);
    if ((await lockedCount(tx, scope.workspaceId)) >= API_KEYS_MAX) throw refuse('LIMIT_REACHED', FULL);
    const [restored] = await tx
      .update(apiKeys)
      .set({ revokedAt: null, revokedByMemberId: null })
      .where(
        and(eq(apiKeys.id, row.id), gt(apiKeys.revokedAt, sql`now() - make_interval(secs => ${API_KEY_UNDO_SECONDS})`)),
      )
      .returning();
    if (restored === undefined) throw refuse('NOT_FOUND', 'That key was revoked for good. Make a new one.');
    await writeAudit(
      tx,
      scope.workspaceId,
      scope.actor,
      {
        action: 'api_key.restored',
        targetType: 'workspace',
        targetId: scope.workspaceId,
        after: { name: row.name, keyId: row.id },
      },
      source,
    );
    return toView(restored);
  });
}
