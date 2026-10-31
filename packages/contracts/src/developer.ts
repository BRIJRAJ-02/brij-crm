// Settings › Developer (parity #34, the first slice): API keys for the public API at `/api/v1`. `apiKeys.*` need
// `api_keys.manage`, behind the member door. A key's whole value is answered once, by the create that made it, and
// never again. Webhooks are spec 0064's.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Uuid, uuidV7 } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** How many live keys a workspace may hold. */
export const API_KEYS_MAX = 25;
/** How long a revoked key can be brought back, in seconds; past it the revoke is for good. */
export const API_KEY_UNDO_SECONDS = 30;
/** How many requests one key may make a minute on `/api/v1`. */
export const API_KEY_REQUESTS_A_MINUTE = 120;
/** How many requests one workspace's keys may make a minute together. */
export const API_WORKSPACE_REQUESTS_A_MINUTE = 600;

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

/** The API key procedures, all `api_keys.manage`. */
export const apiKeysContract = {
  list: oc.input(WorkspaceScoped).output(ApiKeyList),
  create: oc.input(CreateApiKeyInput).output(CreatedApiKey),
  revoke: oc.input(ApiKeyRefInput).output(ApiKey),
  restore: oc.input(ApiKeyRefInput).output(ApiKey),
};
