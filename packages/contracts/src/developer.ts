// Settings › Developer (parity #34, the first slice): API keys for the public API at `/api/v1`. `apiKeys.*` need
// `api_keys.manage`, behind the member door. A key's whole value is answered once, by the create that made it, and
// never again. Webhooks are spec 0064's.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { MAX_QUERY_LIMIT, ValuesById, WriteTimeZone } from './records.ts';
import { Uuid, uuidV7 } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** How many live keys a workspace may hold. */
export const API_KEYS_MAX = 25;
/** How long a revoked key can be brought back, in seconds; past it the revoke is for good. */
export const API_KEY_UNDO_SECONDS = 30;
/** How many requests one key may make a minute on `/api/v1`. */
export const API_KEY_REQUESTS_A_MINUTE = 120;
/** How many `/api/v1` requests one client address may make a minute, keys or not, before any key is looked up. */
export const API_ADDRESS_REQUESTS_A_MINUTE = 600;

/** What a key may do: read records, or read and write them. */
export const API_KEY_ACCESS = ['read', 'write'] as const;
/** What a key may do. */
export const ApiKeyAccess = z.enum(API_KEY_ACCESS, { error: 'Pick what the key may do.' });
/** What a key may do. */
export type ApiKeyAccess = z.infer<typeof ApiKeyAccess>;

/** A key's name: what it's for, so a person can tell their keys apart. */
export const ApiKeyName = z
  .string()
  .trim()
  .min(1, 'Give the key a name.')
  .max(80, 'Keep the name under 80 characters.');

/** One key as Settings › Developer lists it: never its secret, only its last four characters. */
export const ApiKey = z.object({
  id: Uuid,
  name: z.string(),
  access: ApiKeyAccess,
  /** The secret's last four characters. */
  hint: z.string(),
  createdByMemberId: Uuid,
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().optional(),
  /** Set while it is revoked and its Undo window is open. */
  revokedAt: z.iso.datetime().optional(),
});
/** One key. */
export type ApiKey = z.infer<typeof ApiKey>;

/** The workspace's live keys, newest first, and how many it may hold. */
export const ApiKeyList = z.object({ keys: z.array(ApiKey), max: z.literal(API_KEYS_MAX) });
/** The workspace's live keys. */
export type ApiKeyList = z.infer<typeof ApiKeyList>;

/** A new key: the browser's v7 id (the retry key), its name and what it may do. */
export const CreateApiKeyInput = WorkspaceScoped.extend({
  id: uuidV7('The key id must be a UUID v7.'),
  name: ApiKeyName,
  access: ApiKeyAccess,
  mutationId: Uuid,
});
/** A new key. */
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInput>;

/** The key just made, and its whole value: shown once, never stored, never answered again. */
export const CreatedApiKey = z.object({ key: ApiKey, token: z.string() });
/** The key just made, and its whole value. */
export type CreatedApiKey = z.infer<typeof CreatedApiKey>;

/** Revoking a key, or bringing it back within its Undo window. */
export const ApiKeyRefInput = WorkspaceScoped.extend({ keyId: Uuid, mutationId: Uuid });
/** Revoking a key, or bringing it back. */
export type ApiKeyRefInput = z.infer<typeof ApiKeyRefInput>;

/**
 * `GET /api/v1/objects/{object}/records`'s query: a page size (1 to 200, 50 when absent) and the cursor the last page
 * answered. Records come cursor paged, as the app's own table reads them.
 */
export const PublicListRecordsQuery = z.strictObject({
  limit: z.coerce
    .number({ error: 'Use a whole number for limit.' })
    .int('Use a whole number for limit.')
    .min(1, 'Ask for at least 1 record.')
    .max(MAX_QUERY_LIMIT, `Ask for at most ${String(MAX_QUERY_LIMIT)} records.`)
    .optional(),
  cursor: z.string().min(1, 'That cursor is empty.').max(4_096, 'That cursor is too long.').optional(),
});
/** A page's query. */
export type PublicListRecordsQuery = z.infer<typeof PublicListRecordsQuery>;

/**
 * `POST /api/v1/objects/{object}/records`'s body: its first values by attribute id (the app's own `ValuesById`) and,
 * optionally, its id (a UUID v7 you mint, the retry key: the same create again answers the record already made; send
 * one whenever you may retry) and a time zone (the app's `WriteTimeZone`).
 */
export const PublicCreateRecordBody = z.strictObject({
  id: uuidV7('The record id must be a UUID v7.').optional(),
  values: ValuesById.optional(),
  timeZone: WriteTimeZone,
});
/** A new record. */
export type PublicCreateRecordBody = z.infer<typeof PublicCreateRecordBody>;

/** `PATCH /api/v1/objects/{object}/records/{id}`'s body: the values to change by attribute id, all or none. */
export const PublicUpdateRecordBody = z.strictObject({ values: ValuesById, timeZone: WriteTimeZone });
/** New values for a record. */
export type PublicUpdateRecordBody = z.infer<typeof PublicUpdateRecordBody>;

/** The API key procedures, all `api_keys.manage`. */
export const apiKeysContract = {
  list: oc.input(WorkspaceScoped).output(ApiKeyList),
  create: oc.input(CreateApiKeyInput).output(CreatedApiKey),
  revoke: oc.input(ApiKeyRefInput).output(ApiKey),
  restore: oc.input(ApiKeyRefInput).output(ApiKey),
};
