// The files under `.load/` (spec 0011, data model sketch): the manifest the
// seed writes and the session cookies minted for its users. Both are local to
// this machine and gitignored; the harness (`packages/load`, milestone 2)
// reads them through these schemas.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod';
import { loadRefusal } from './load-local.ts';

/** The seed profiles' names. */
export const SeedProfileName = z.enum(['crm', 'smoke', 'test']);
export type SeedProfileName = z.infer<typeof SeedProfileName>;

/** One seeded member: user `n` (`load-user-<n>@example.com`), its identity and its member row. */
export const LoadUser = z.object({
  n: z.number().int().positive(),
  email: z.email(),
  userId: z.uuid(),
  memberId: z.uuid(),
});
export type LoadUser = z.infer<typeof LoadUser>;

/** What `pnpm load:seed` made: everything a run needs to find its way around the seeded workspace. */
export const LoadManifest = z.object({
  profile: SeedProfileName,
  workspaceId: z.uuid(),
  slug: z.string(),
  /** When the seed finished, on the database's clock: anything created later is the harness's. */
  seededAt: z.iso.datetime({ offset: true }),
  /** Object ids by standard key (`people`, `companies`, `deals`). */
  objects: z.record(z.string(), z.uuid()),
  /** Attribute ids by `<object key>.<api slug>`, such as `people.job_title`. */
  attributes: z.record(z.string(), z.uuid()),
  hubCompanyId: z.uuid(),
  /** The hub's Team attribute (Companies `team`), the many side that holds the hub's people. */
  hubTeamAttributeId: z.uuid(),
  /** Records per object key: every row stored, and the live ones (not in the trash). */
  counts: z.record(z.string(), z.object({ stored: z.number().int(), live: z.number().int() })),
  users: z.array(LoadUser),
  /** Up to 10,000 live record ids per object key, picked by a hash of the id, for `spread`. */
  samples: z.record(z.string(), z.array(z.uuid())),
});
export type LoadManifest = z.infer<typeof LoadManifest>;

/** The minted session cookies (AC-196), by user number, for the API at `apiUrl`. */
export const LoadSessions = z.object({
  apiUrl: z.url(),
  mintedAt: z.iso.datetime({ offset: true }),
  sessions: z.record(z.string(), z.string()),
});
export type LoadSessions = z.infer<typeof LoadSessions>;

const MANIFEST = 'manifest.json';
const SESSIONS = 'sessions.json';

async function writeJson(dir: string, name: string, value: unknown): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return path;
}

/** Writes `.load/manifest.json` in `dir`, and returns its path. */
export function writeManifest(dir: string, manifest: LoadManifest): Promise<string> {
  return writeJson(dir, MANIFEST, LoadManifest.parse(manifest));
}

/** Writes `.load/sessions.json` in `dir` (readable by this user only: it holds live cookies), and returns its path. */
export function writeSessions(dir: string, sessions: LoadSessions): Promise<string> {
  return writeJson(dir, SESSIONS, LoadSessions.parse(sessions));
}

/** Reads `.load/manifest.json` in `dir`, refusing (exit 3) when there is none, naming `pnpm load:seed`. */
export async function readManifest(dir: string): Promise<LoadManifest> {
  let text: string;
  try {
    text = await readFile(join(dir, MANIFEST), 'utf8');
  } catch {
    throw loadRefusal(`There is no ${join(dir, MANIFEST)}. Seed the load stack first: \`pnpm load:seed\`.`);
  }
  return LoadManifest.parse(JSON.parse(text));
}
