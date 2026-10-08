// What `instrument.ts` reads before Sentry starts (spec 0010): its own small
// environment and which service this process is. Kept apart from
// `instrument.ts`, which only runs, so tests can read them.
import { basename } from 'node:path';
import { AppEnvironment } from '@crm/contracts';
import * as z from 'zod';
import { optional } from '../env.ts';
import type { Service } from './sentry.ts';

/** The entry file each service starts from, for when the start command doesn't set `SERVICE`. */
const ENTRY_SERVICES: Readonly<Record<string, Service>> = { 'server.ts': 'api', 'worker.ts': 'worker' };

export const MonitoringEnv = z.object({
  APP_ENV: AppEnvironment,
  // A DSN is a URL with the project's public key; Sentry ingests over https only. Unset means off.
  SENTRY_DSN_SERVER: optional(z.url({ protocol: /^https$/, error: 'SENTRY_DSN_SERVER must be an https URL.' })),
  // Railway sets it on every deploy; a laptop has none.
  RAILWAY_GIT_COMMIT_SHA: optional(z.string().regex(/^[0-9a-f]{7,40}$/i)),
  SERVICE: optional(z.enum(['api', 'worker'])),
});
export type MonitoringEnv = z.infer<typeof MonitoringEnv>;

/** Which service this process is: `SERVICE` when set, else the entry file it was started with (`server.ts`, `worker.ts`). */
export function serviceFor(env: MonitoringEnv, entry: string | undefined): Service {
  return env.SERVICE ?? ENTRY_SERVICES[basename(entry ?? '')] ?? 'api';
}
