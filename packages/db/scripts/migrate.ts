// Applies every migration as the owner role, over the direct connection:
// Graphile Worker's own first, then ours, then the rights on Graphile's schema
// (`applyMigrations`, spec 0008). Runs as the api service's pre deploy step,
// before the new version starts.
import * as z from 'zod';
import { assertDirectUrl } from '../src/direct.ts';
import { applyMigrations } from '../src/migrations.ts';
import { scriptEnv } from './env.ts';

const env = scriptEnv({ DATABASE_URL_OWNER: z.url() });
assertDirectUrl(env.DATABASE_URL_OWNER, 'DATABASE_URL_OWNER');

await applyMigrations(env.DATABASE_URL_OWNER, 'crm-migrate');
console.log('Migrations applied.');
