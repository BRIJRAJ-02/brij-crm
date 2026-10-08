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

/** An optional variable where an empty value (`NAME=` in a file) counts as unset. */
export function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

const shared = {
  APP_ENV: AppEnvironment,
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.url(),
};

// The edge guard's shared secret (spec 0005, #57): required outside local (see the check below), where an
// empty value counts as unset, so `.env.example`'s `EDGE_SECRET=` boots on a laptop.
const edgeSecret = optional(
  z
    .string()
    .min(32, 'EDGE_SECRET must be at least 32 characters.')
    // A header carries it: printable ASCII with no spaces, so nothing is trimmed or refused on the way.
    .regex(/^[\x21-\x7e]+$/, 'EDGE_SECRET may hold only printable ASCII characters, with no spaces.'),
);

// The relay's wake secret (spec 0005): the api sends it with each poke to the worker, which takes no poke without
// it. Required outside local on both; like the edge secret, a header carries it.
const wakeSecret = optional(
  z
    .string()
    .min(32, 'WORKER_WAKE_SECRET must be at least 32 characters.')
    .regex(/^[\x21-\x7e]+$/, 'WORKER_WAKE_SECRET may hold only printable ASCII characters, with no spaces.'),
);

/** The marker `.env.example`'s placeholder secret carries: fine on a laptop, refused anywhere else. */
export const LOCAL_SECRET_MARKER = 'local-only';

/** `.env.example`'s (and docker-compose.yml's) Centrifugo API key: fine on a laptop, refused anywhere else. */
export const LOCAL_CENTRIFUGO_API_KEY = 'local-centrifugo-api-key';

/** `.env.example`'s (and docker-compose.yml's) Centrifugo token secret: fine on a laptop, refused anywhere else. */
export const LOCAL_CENTRIFUGO_TOKEN_SECRET = 'local-centrifugo-token-secret';

/**
 * An address on the private network or this machine, or else https: the
 * relay's key and the wake secret travel in its headers. Plain http only to a
 * Railway private host (`*.railway.internal`, which Railway encrypts) or
 * localhost.
 */
function internalUrl(variable: string) {
  return z.url().refine(
    (value) => {
      // z.url() has already said so; one issue is enough.
      if (!URL.canParse(value)) return true;
      const url = new URL(value);
      if (url.protocol === 'https:') return true;
      const host = url.hostname;
      return (
        url.protocol === 'http:' &&
        (host.endsWith('.railway.internal') || host === 'localhost' || host === '127.0.0.1' || host === '[::1]')
      );
    },
    { message: `${variable} must be https, or http to a *.railway.internal host or localhost.` },
  );
}

// A sender: `address@domain`, or `Name <address@domain>`.
const sender = z
  .string()
  .regex(
    /^(?:[^<>@\n]+ <[^<>\s@]+@[^<>\s@]+>|[^<>\s@]+@[^<>\s@]+)$/,
    'MAIL_FROM must be an address, or a name and an address like "CRM <sign-in@example.com>".',
  );

// Emails allowed to sign up: comma separated, compared lowercased. `*` alone opens sign up to every email
// (the owner's call, 3 October 2026), shown as the one entry '*'.
const allowlist = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(
    z.union([
      z.tuple([z.literal('*')]),
      z.array(z.email('SIGNUP_ALLOWLIST holds emails, comma separated, or * alone for everyone.')),
    ]),
  );

/** Locally, codes land in Mailpit unless a Resend key is set. */
const DEFAULT_LOCAL_SENDER = 'CRM <sign-in@crm.localhost>';

export const ApiEnv = z
  .object({
    ...shared,
    PORT: z.coerce.number().int().positive().default(3000),
    APP_URL: z.url(),
    TRUSTED_ORIGINS: origins.optional(),
    EDGE_SECRET: edgeSecret,
    // Sign in (spec 0005).
    IDENTITY_DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters.'),
    BETTER_AUTH_URL: z.url(),
    GOOGLE_CLIENT_ID: optional(z.string()),
    GOOGLE_CLIENT_SECRET: optional(z.string()),
    SIGNUP_ALLOWLIST: optional(allowlist),
    // Mail: Resend when its key is set, else Mailpit (local only).
    RESEND_API_KEY: optional(z.string()),
    MAIL_FROM: optional(sender),
    MAILPIT_URL: optional(z.url()),
    // The relay's wake up call (spec 0005): the worker's internal address, and the secret it checks.
    WORKER_INTERNAL_URL: optional(internalUrl('WORKER_INTERNAL_URL')),
    WORKER_WAKE_SECRET: wakeSecret,
    // Live updates (spec 0005): signs Centrifugo's connection and subscription tokens. The Centrifugo service's
    // CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY. Required in production; unset (previews) turns live updates off.
    CENTRIFUGO_TOKEN_SECRET: optional(z.string()),
    // Monitoring (spec 0010): `on` opens system.testFault, which fails on purpose to prove error reports in
    // production; unset or `off` answers NOT_FOUND, as if it didn't exist. Switch it off again after the proof.
    MONITORING_TEST_FAULT: optional(z.enum(['on', 'off'])),
  })
  .superRefine((env, issues) => {
    const missing = (path: string, message: string) => issues.addIssue({ code: 'custom', path: [path], message });
    if ((env.GOOGLE_CLIENT_ID === undefined) !== (env.GOOGLE_CLIENT_SECRET === undefined)) {
      missing('GOOGLE_CLIENT_SECRET', 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET together, or neither.');
    }
    // `local` turns off the edge guard, the Secure cookie, the allowlist and the placeholder secret checks, and
    // trusts the laptop origins. A production build never runs with all of that off.
    if (env.APP_ENV === 'local' && env.NODE_ENV === 'production') {
      missing('APP_ENV', 'APP_ENV=local is refused when NODE_ENV=production. Set APP_ENV to preview or production.');
    }
    if (env.APP_ENV === 'local') {
      if (env.RESEND_API_KEY === undefined && env.MAILPIT_URL === undefined) {
        missing('MAILPIT_URL', 'Set MAILPIT_URL (Mailpit, http://localhost:8025) or RESEND_API_KEY to send codes.');
      }
      return;
    }
    // Without it anyone could call the API's public Railway address around the app (see edge.ts).
    if (env.EDGE_SECRET === undefined) {
      missing('EDGE_SECRET', `EDGE_SECRET is required in ${env.APP_ENV}: the same value the Vercel project sends.`);
    }
    if (env.RESEND_API_KEY === undefined) missing('RESEND_API_KEY', `RESEND_API_KEY is required in ${env.APP_ENV}.`);
    // Without them the relay stays dormant after a write, and changes wait for the next poke.
    if (env.WORKER_INTERNAL_URL === undefined) {
      missing(
        'WORKER_INTERNAL_URL',
        `WORKER_INTERNAL_URL is required in ${env.APP_ENV}: the worker's internal address.`,
      );
    }
    if (env.WORKER_WAKE_SECRET === undefined) {
      missing(
        'WORKER_WAKE_SECRET',
        `WORKER_WAKE_SECRET is required in ${env.APP_ENV}: the same value the worker holds.`,
      );
    } else if (env.WORKER_WAKE_SECRET.includes(LOCAL_SECRET_MARKER)) {
      missing('WORKER_WAKE_SECRET', 'That is the local placeholder. Generate one: `openssl rand -hex 32`.');
    }
    if (env.MAIL_FROM === undefined) missing('MAIL_FROM', `MAIL_FROM is required in ${env.APP_ENV}.`);
    if (env.CENTRIFUGO_TOKEN_SECRET === undefined) {
      if (env.APP_ENV === 'production') {
        missing(
          'CENTRIFUGO_TOKEN_SECRET',
          "CENTRIFUGO_TOKEN_SECRET is required in production: the Centrifugo service's token secret.",
        );
      }
    } else if (env.CENTRIFUGO_TOKEN_SECRET === LOCAL_CENTRIFUGO_TOKEN_SECRET) {
      missing('CENTRIFUGO_TOKEN_SECRET', "That is the local secret. Use the Centrifugo service's token secret.");
    } else if (env.CENTRIFUGO_TOKEN_SECRET.length < 32) {
      missing('CENTRIFUGO_TOKEN_SECRET', `CENTRIFUGO_TOKEN_SECRET must be at least 32 characters in ${env.APP_ENV}.`);
    }
    if (env.BETTER_AUTH_SECRET.includes(LOCAL_SECRET_MARKER)) {
      missing('BETTER_AUTH_SECRET', 'That is the local placeholder. Generate one: `openssl rand -base64 32`.');
    }
    // The app and the API share one origin (Vercel proxies /api), so sign in links and cookies name that origin.
    if (new URL(env.BETTER_AUTH_URL).origin !== new URL(env.APP_URL).origin) {
      missing('BETTER_AUTH_URL', `BETTER_AUTH_URL must have the same origin as APP_URL in ${env.APP_ENV}.`);
    }
  })
  .transform((env) => ({
    ...env,
    MAIL_FROM: env.MAIL_FROM ?? DEFAULT_LOCAL_SENDER,
    // Mailpit is a laptop's inbox; a deployed API never sends there.
    MAILPIT_URL: env.APP_ENV === 'local' ? env.MAILPIT_URL : undefined,
  }));
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
    // The relay publishes to Centrifugo's server API (spec 0005): its internal port (9000), and its HTTP API key.
    // Both or neither; required outside local. Locally, without them the worker boots with the relay off.
    CENTRIFUGO_API_URL: optional(internalUrl('CENTRIFUGO_API_URL')),
    CENTRIFUGO_API_KEY: optional(z.string()),
    // The api's poke must carry it (spec 0005). Required outside local; locally, unset takes any poke.
    WORKER_WAKE_SECRET: wakeSecret,
  })
  .superRefine((env, issues) => {
    const missing = (path: string, message: string) => issues.addIssue({ code: 'custom', path: [path], message });
    const url = env.CENTRIFUGO_API_URL === undefined;
    const key = env.CENTRIFUGO_API_KEY === undefined;
    if (url !== key)
      missing('CENTRIFUGO_API_KEY', 'Set CENTRIFUGO_API_URL and CENTRIFUGO_API_KEY together, or neither.');
    if (env.APP_ENV !== 'local' && url) {
      missing('CENTRIFUGO_API_URL', `CENTRIFUGO_API_URL is required in ${env.APP_ENV}: the relay publishes there.`);
    }
    if (env.APP_ENV === 'local') return;
    if (key) {
      missing('CENTRIFUGO_API_KEY', `CENTRIFUGO_API_KEY is required in ${env.APP_ENV}.`);
    } else if (env.CENTRIFUGO_API_KEY === LOCAL_CENTRIFUGO_API_KEY) {
      missing('CENTRIFUGO_API_KEY', "That is the local key. Use the Centrifugo service's CENTRIFUGO_HTTP_API_KEY.");
    } else if ((env.CENTRIFUGO_API_KEY?.length ?? 0) < 32) {
      missing('CENTRIFUGO_API_KEY', `CENTRIFUGO_API_KEY must be at least 32 characters in ${env.APP_ENV}.`);
    }
    if (env.WORKER_WAKE_SECRET === undefined) {
      missing('WORKER_WAKE_SECRET', `WORKER_WAKE_SECRET is required in ${env.APP_ENV}: the same value the api sends.`);
    } else if (env.WORKER_WAKE_SECRET.includes(LOCAL_SECRET_MARKER)) {
      missing('WORKER_WAKE_SECRET', 'That is the local placeholder. Generate one: `openssl rand -hex 32`.');
    }
  })
  .transform(({ WORKER_PORT, PORT, CENTRIFUGO_API_URL, CENTRIFUGO_API_KEY, ...rest }) => ({
    ...rest,
    WORKER_PORT: WORKER_PORT ?? PORT ?? 3001,
    // The relay's Centrifugo, when it is on.
    centrifugo:
      CENTRIFUGO_API_URL === undefined || CENTRIFUGO_API_KEY === undefined
        ? undefined
        : { apiUrl: CENTRIFUGO_API_URL, apiKey: CENTRIFUGO_API_KEY },
  }));
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
