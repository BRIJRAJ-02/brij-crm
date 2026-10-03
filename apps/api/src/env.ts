import { AppEnvironment } from '@crm/contracts';
import * as z from 'zod';

const origins = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()).min(1));

const shared = {
  APP_ENV: AppEnvironment,
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.url(),
};

// The edge guard's shared secret (spec 0005). Optional while it rolls out; an
// empty value counts as unset, so `.env.example`'s `EDGE_SECRET=` boots.
const edgeSecret = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value))
  .pipe(
    z
      .string()
      .min(32, 'EDGE_SECRET must be at least 32 characters.')
      // A header carries it: printable ASCII with no spaces, so nothing is trimmed or refused on the way.
      .regex(/^[\x21-\x7e]+$/, 'EDGE_SECRET may hold only printable ASCII characters, with no spaces.')
      .optional(),
  );

export const ApiEnv = z.object({
  ...shared,
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.url(),
  TRUSTED_ORIGINS: origins.optional(),
  EDGE_SECRET: edgeSecret,
});
export type ApiEnv = z.infer<typeof ApiEnv>;

const port = z.coerce.number().int().positive();

export const WorkerEnv = z
  .object({
    ...shared,
    // Locally the api owns PORT, so the worker uses WORKER_PORT. On Railway
    // each service gets its own PORT, which the health check calls.
    WORKER_PORT: port.optional(),
    PORT: port.optional(),
    DATABASE_URL_DIRECT: z.url(),
  })
  .transform(({ WORKER_PORT, PORT, ...rest }) => ({ ...rest, WORKER_PORT: WORKER_PORT ?? PORT ?? 3001 }));
export type WorkerEnv = z.infer<typeof WorkerEnv>;

/** Parses the environment, or stops the process with every missing or invalid variable named. */
export function loadEnv<T extends z.ZodType>(schema: T): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error(`Refusing to start, the environment is invalid:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data;
}
