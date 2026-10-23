import { AppEnvironment } from '@crm/contracts';
import { decodeTokenKey, type TokenKey } from '@crm/core';
import * as z from 'zod';

/** A public origin a browser may send as `Origin`: https, or http on localhost; never one whose origin is `null`. */
const publicOrigin = z.url().refine(
  (value) => {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  },
  { error: 'Use an https origin (http only on localhost).' },
);

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
  // Render sets `true` on every service (spec 0044): there a one label host is the private network address.
  RENDER: optional(z.string()),
  // Vercel sets `1` in every function (spec 0045): there the api runs as a Vercel Function, with no worker beside it.
  VERCEL: optional(z.string()),
};

// A deployed commit's sha, as the host reports it.
const commitSha = optional(z.string().regex(/^[0-9a-f]{7,40}$/i));

/**
 * The deployed commit, which the host sets: Render's `RENDER_GIT_COMMIT`, Railway's `RAILWAY_GIT_COMMIT_SHA`
 * (spec 0044), or Vercel's `VERCEL_GIT_COMMIT_SHA` while the api runs as a Vercel Function (spec 0045). A laptop
 * has none.
 */
export const DeployedCommit = {
  RENDER_GIT_COMMIT: commitSha,
  RAILWAY_GIT_COMMIT_SHA: commitSha,
  VERCEL_GIT_COMMIT_SHA: commitSha,
};

/** The release /api/health and Sentry name: the deployed commit from whichever host set one, else `local`. */
export function releaseOf(env: {
  readonly RENDER_GIT_COMMIT?: string | undefined;
  readonly RAILWAY_GIT_COMMIT_SHA?: string | undefined;
  readonly VERCEL_GIT_COMMIT_SHA?: string | undefined;
}): string {
  return env.RENDER_GIT_COMMIT ?? env.RAILWAY_GIT_COMMIT_SHA ?? env.VERCEL_GIT_COMMIT_SHA ?? 'local';
}

/** Whether the api runs as a Vercel Function (spec 0045): Vercel sets `VERCEL=1` there, and nowhere else does. */
export function onVercel(env: { readonly VERCEL?: string | undefined }): boolean {
  return env.VERCEL === '1';
}

/** Whether a one label host is a private network address: Render's, or a compose service with APP_ENV=local. */
const oneLabelAllowed = (env: { readonly APP_ENV: string; readonly RENDER?: string | undefined }) =>
  env.APP_ENV === 'local' || env.RENDER === 'true';

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

// The key a booking's guest page token derives from (spec 0025, milestone 2): the api and the worker hold the same
// value. Unset, it derives from WORKER_WAKE_SECRET, which both already share (`booking-link.ts`).
const bookingLinkSecret = optional(
  z
    .string()
    .min(32, 'BOOKING_LINK_SECRET must be at least 32 characters.')
    .refine((value) => !value.includes('local-only'), {
      error: 'That is a local placeholder. Generate one: `openssl rand -hex 32`.',
    }),
);

/** The marker `.env.example`'s placeholder secret carries: fine on a laptop, refused anywhere else. */
export const LOCAL_SECRET_MARKER = 'local-only';

/** `.env.example`'s (and docker-compose.yml's) Centrifugo API key: fine on a laptop, refused anywhere else. */
export const LOCAL_CENTRIFUGO_API_KEY = 'local-centrifugo-api-key';

/** `.env.example`'s (and docker-compose.yml's) Centrifugo token secret: fine on a laptop, refused anywhere else. */
export const LOCAL_CENTRIFUGO_TOKEN_SECRET = 'local-centrifugo-token-secret';

/**
 * A Docker Compose service name (`worker`, `centrifugo`): one label, no dots,
 * so no public DNS name matches it and only a compose network resolves it.
 */
function isComposeService(host: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(host) && host !== 'localhost';
}

/**
 * True when `value` is plain http to a compose service name, which only
 * `APP_ENV=local` takes: the load stack (spec 0011, milestone 3), where the
 * api pokes `http://worker:3101` and the relay publishes to
 * `http://centrifugo:9000` inside its own compose network.
 */
function isComposeServiceUrl(value: string | undefined): boolean {
  if (value === undefined || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'http:' && isComposeService(url.hostname);
}

/**
 * An address on the private network or this machine, or else https: the
 * relay's key and the wake secret travel in its headers. Plain http only to a
 * Railway private host (`*.railway.internal`, which Railway encrypts),
 * localhost, or a one label name: a compose service, or a Render private
 * address, which the environment's own check then refuses unless
 * `APP_ENV=local` or on Render (`composeOnlyLocally`). A bare `host:port`, as
 * Render's Blueprint hands over a service's `hostport`, is read as plain http.
 */
function internalUrl(variable: string) {
  const bareHostPort = /^[a-z][a-z0-9-]*:\d{1,5}$/;
  const withScheme = (value: unknown) =>
    typeof value === 'string' && bareHostPort.test(value) ? `http://${value}` : value;
  return z.preprocess(
    withScheme,
    z.url().refine(
      (value) => {
        // z.url() has already said so; one issue is enough.
        if (!URL.canParse(value)) return true;
        const url = new URL(value);
        if (url.protocol === 'https:') return true;
        const host = url.hostname;
        return (
          url.protocol === 'http:' &&
          (host.endsWith('.railway.internal') ||
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '[::1]' ||
            isComposeService(host))
        );
      },
      {
        message: `${variable} must be https, or http to a *.railway.internal host or localhost (or, with APP_ENV=local or on Render, a one label private host).`,
      },
    ),
  );
}

/** The refusal for plain http to a compose service name outside local. */
const composeOnlyLocally = (variable: string, appEnv: string) =>
  `${variable} names a one label host over plain http, which only APP_ENV=local or Render takes (not ${appEnv}). Use https, a *.railway.internal host or localhost.`;

// A sender: `address@domain`, or `Name <address@domain>`.
const sender = z
  .string()
  .regex(
    /^(?:[^<>@\n]+ <[^<>\s@]+@[^<>\s@]+>|[^<>\s@]+@[^<>\s@]+)$/,
    'MAIL_FROM must be an address, or a name and an address like "Timefix <sign-in@example.com>".',
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

// Calendar sync (spec 0024): off unless `CALENDAR_SYNC=on`, so the app boots without it. On, it needs a Google
// OAuth client with the Calendar API enabled (it may be sign in's client, with the redirect URI
// `<APP_URL>/api/calendar/google/callback` added), the 32 byte key members' tokens are sealed with, and (outside
// local) the public https origin Google posts push notices to. Both the api and the worker read them: the worker
// refreshes tokens and syncs. Outlook (spec 0024 milestone 4, AC-1012) is off unless `CALENDAR_OUTLOOK=on` too, and
// then needs the Entra app's client id and secret (`MICROSOFT_TENANT` is `common` unless set): an app registered for
// "accounts in any organizational directory and personal Microsoft accounts", with the redirect URI
// `<APP_URL>/api/calendar/microsoft/callback` and the delegated permissions offline_access, User.Read and
// Calendars.ReadWrite.
const calendarFields = {
  CALENDAR_SYNC: optional(z.enum(['on', 'off'])),
  GOOGLE_CALENDAR_CLIENT_ID: optional(z.string().trim().min(1)),
  GOOGLE_CALENDAR_CLIENT_SECRET: optional(z.string().trim().min(1)),
  CALENDAR_TOKEN_KEY: optional(z.string()),
  CALENDAR_WEBHOOK_ORIGIN: optional(z.url()),
  CALENDAR_OUTLOOK: optional(z.enum(['on', 'off'])),
  MICROSOFT_CLIENT_ID: optional(z.string().trim().min(1)),
  MICROSOFT_CLIENT_SECRET: optional(z.string().trim().min(1)),
  MICROSOFT_TENANT: optional(
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9.-]{1,100}$/, 'MICROSOFT_TENANT is `common`, `organizations`, a tenant id or a domain.'),
  ),
};

/** The calendar variables as parsed, before they are checked together. */
interface CalendarFields {
  readonly CALENDAR_SYNC?: 'on' | 'off' | undefined;
  readonly GOOGLE_CALENDAR_CLIENT_ID?: string | undefined;
  readonly GOOGLE_CALENDAR_CLIENT_SECRET?: string | undefined;
  readonly CALENDAR_TOKEN_KEY?: string | undefined;
  readonly CALENDAR_WEBHOOK_ORIGIN?: string | undefined;
  readonly CALENDAR_OUTLOOK?: 'on' | 'off' | undefined;
  readonly MICROSOFT_CLIENT_ID?: string | undefined;
  readonly MICROSOFT_CLIENT_SECRET?: string | undefined;
  readonly MICROSOFT_TENANT?: string | undefined;
}

/** Outlook's Entra app once checked (spec 0024 milestone 4). */
export interface MicrosoftSettings {
  readonly clientId: string;
  readonly clientSecret: string;
  /** `common` unless set: work or school accounts and personal ones. */
  readonly tenant: string;
}

/** Calendar sync's settings once checked: its Google client, the token key, and where Google posts notices. */
export interface CalendarSettings {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenKey: TokenKey;
  /** The public https origin for push notices (milestone 2); unset locally, where sync runs on the poll. */
  readonly webhookOrigin: string | undefined;
  /** Outlook (milestone 4), where `CALENDAR_OUTLOOK=on`; else Connect Outlook isn't offered. */
  readonly microsoft: MicrosoftSettings | undefined;
}

/** Refuses calendar sync switched on without what it needs; nothing is asked of it while it is off. */
function checkCalendar(
  env: CalendarFields & { readonly APP_ENV: string },
  missing: (path: string, message: string) => void,
): void {
  if (env.CALENDAR_OUTLOOK === 'on' && env.CALENDAR_SYNC !== 'on') {
    missing('CALENDAR_SYNC', 'CALENDAR_OUTLOOK=on needs CALENDAR_SYNC=on too.');
  }
  if (env.CALENDAR_SYNC !== 'on') return;
  if (env.CALENDAR_OUTLOOK === 'on') {
    if (env.MICROSOFT_CLIENT_ID === undefined) {
      missing(
        'MICROSOFT_CLIENT_ID',
        'CALENDAR_OUTLOOK=on needs MICROSOFT_CLIENT_ID: the Entra app registration for Outlook calendars.',
      );
    }
    if (env.MICROSOFT_CLIENT_SECRET === undefined) {
      missing('MICROSOFT_CLIENT_SECRET', 'CALENDAR_OUTLOOK=on needs MICROSOFT_CLIENT_SECRET.');
    }
  }
  if (env.GOOGLE_CALENDAR_CLIENT_ID === undefined) {
    missing(
      'GOOGLE_CALENDAR_CLIENT_ID',
      'CALENDAR_SYNC=on needs GOOGLE_CALENDAR_CLIENT_ID: a Google OAuth client with the Calendar API enabled.',
    );
  }
  if (env.GOOGLE_CALENDAR_CLIENT_SECRET === undefined) {
    missing('GOOGLE_CALENDAR_CLIENT_SECRET', 'CALENDAR_SYNC=on needs GOOGLE_CALENDAR_CLIENT_SECRET.');
  }
  if (env.CALENDAR_TOKEN_KEY === undefined) {
    missing('CALENDAR_TOKEN_KEY', 'CALENDAR_SYNC=on needs CALENDAR_TOKEN_KEY. Make one: `openssl rand -base64 32`.');
  } else {
    try {
      decodeTokenKey(env.CALENDAR_TOKEN_KEY);
    } catch (error) {
      missing('CALENDAR_TOKEN_KEY', error instanceof Error ? error.message : 'CALENDAR_TOKEN_KEY is not a key.');
    }
  }
  const origin = env.CALENDAR_WEBHOOK_ORIGIN;
  if (origin !== undefined && URL.canParse(origin) && new URL(origin).origin !== origin.replace(/\/$/, '')) {
    missing('CALENDAR_WEBHOOK_ORIGIN', 'CALENDAR_WEBHOOK_ORIGIN is an origin only, such as https://api.example.com.');
  }
  if (env.APP_ENV === 'local') return;
  if (origin === undefined) {
    missing(
      'CALENDAR_WEBHOOK_ORIGIN',
      `CALENDAR_SYNC=on needs CALENDAR_WEBHOOK_ORIGIN in ${env.APP_ENV}: the public https origin Google posts to.`,
    );
  } else if (URL.canParse(origin) && new URL(origin).protocol !== 'https:') {
    missing('CALENDAR_WEBHOOK_ORIGIN', `CALENDAR_WEBHOOK_ORIGIN must be https in ${env.APP_ENV}.`);
  }
}

/** Calendar sync's settings, or undefined while it is off (the checks above already ran). */
function calendarOf(env: CalendarFields): CalendarSettings | undefined {
  if (
    env.CALENDAR_SYNC !== 'on' ||
    env.GOOGLE_CALENDAR_CLIENT_ID === undefined ||
    env.GOOGLE_CALENDAR_CLIENT_SECRET === undefined ||
    env.CALENDAR_TOKEN_KEY === undefined
  ) {
    return undefined;
  }
  return {
    clientId: env.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
    tokenKey: decodeTokenKey(env.CALENDAR_TOKEN_KEY),
    webhookOrigin: env.CALENDAR_WEBHOOK_ORIGIN === undefined ? undefined : new URL(env.CALENDAR_WEBHOOK_ORIGIN).origin,
    microsoft:
      env.CALENDAR_OUTLOOK === 'on' &&
      env.MICROSOFT_CLIENT_ID !== undefined &&
      env.MICROSOFT_CLIENT_SECRET !== undefined
        ? {
            clientId: env.MICROSOFT_CLIENT_ID,
            clientSecret: env.MICROSOFT_CLIENT_SECRET,
            tenant: env.MICROSOFT_TENANT ?? 'common',
          }
        : undefined,
  };
}

/** The name every email is sent under when MAIL_FROM gives only an address. */
const SENDER_NAME = 'Timefix';

/** Locally, codes land in Mailpit unless a Resend key is set. */
const DEFAULT_LOCAL_SENDER = `${SENDER_NAME} <sign-in@crm.localhost>`;

/** A sender with a name: a bare address goes out as "Timefix <address>"; a named one is kept as it is. */
const namedSender = (sender: string) => (sender.includes('<') ? sender : `${SENDER_NAME} <${sender}>`);

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
    BOOKING_LINK_SECRET: bookingLinkSecret,
    // Spec 0008's wake on use: every signed in request wakes the worker at most once a minute, so it sleeps only when
    // nobody uses the app. Unset is `on` locally and in previews and `off` in production, where the worker's jobs
    // (and so its sleep) stay off until the owner turns them on; set it `on` with JOBS_RUNNER (verify.md).
    WORKER_WAKE_ON_USE: optional(z.enum(['on', 'off'])),
    // Live updates (spec 0005): signs Centrifugo's connection and subscription tokens. The Centrifugo service's
    // CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY. Unset turns live updates off.
    CENTRIFUGO_TOKEN_SECRET: optional(z.string()),
    // The deployed commit, which the host sets: /api/health names it, so the web deploy can wait for this API.
    ...DeployedCommit,
    // Monitoring (spec 0010): `on` opens system.testFault, which fails on purpose to prove error reports in
    // production; unset or `off` answers NOT_FOUND, as if it didn't exist. Switch it off again after the proof.
    MONITORING_TEST_FAULT: optional(z.enum(['on', 'off'])),
    // Product analytics (spec 0010, milestone 3): the PostHog EU project's key. Unset means nothing is sent, which
    // is how local, tests and previews run; production has it. The host defaults to PostHog's EU ingest.
    POSTHOG_KEY: optional(
      z.string().regex(/^phc_[A-Za-z0-9_-]{1,200}$/, 'POSTHOG_KEY is the project key, the one starting phc_.'),
    ),
    // Only PostHog's EU ingest: events never go to another region or host. posthog-node posts to it alone (no
    // assets host), so the list holds one entry.
    POSTHOG_HOST: optional(
      z.enum(['https://eu.i.posthog.com'], { error: 'POSTHOG_HOST may only be https://eu.i.posthog.com.' }),
    ),
    // The load harness's timing header (spec 0011, AC-202): `on` adds `Server-Timing` (pool wait, database and
    // handler time) to every /api/rpc answer. Local only: it exposes internal timings, so it is refused elsewhere.
    LOAD_TIMING: optional(z.enum(['on', 'off'])),
    ...calendarFields,
    // Forms (spec 0023): reCAPTCHA v3's keys, the site key sent to browsers and the secret the API verifies tokens
    // with. Both or neither, and optional everywhere: unset, the honeypot, the fill time and the rate limits decide
    // alone; set, the score is one more spam signal.
    RECAPTCHA_SITE_KEY: optional(
      z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, 'RECAPTCHA_SITE_KEY is a reCAPTCHA v3 site key.'),
    ),
    RECAPTCHA_SECRET_KEY: optional(
      z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, 'RECAPTCHA_SECRET_KEY is a reCAPTCHA v3 secret key.'),
    ),
    // The salt client addresses are hashed with for the form rate limits and abuse review (rotating it only resets
    // rate limit history). Required outside local; locally a fixed placeholder stands in.
    FORMS_IP_SALT: optional(z.string().min(32, 'FORMS_IP_SALT must be at least 32 characters.')),
    // The origin hosted form pages are served from, when it differs from APP_URL (it defaults to APP_URL).
    FORMS_PUBLIC_ORIGIN: optional(z.url()),
    // The origin the public booking addresses are served from (`/<handle>`, `/<handle>/<slug>`, `/b/<key>`), when it
    // differs from APP_URL (it defaults to APP_URL): links in emails and calendar files point there, and the
    // booking pages' writes from it are accepted. The same deployment answers on both.
    BOOKING_PUBLIC_ORIGIN: optional(publicOrigin),
  })
  .superRefine((env, issues) => {
    const missing = (path: string, message: string) => issues.addIssue({ code: 'custom', path: [path], message });
    checkCalendar(env, missing);
    if ((env.RECAPTCHA_SITE_KEY === undefined) !== (env.RECAPTCHA_SECRET_KEY === undefined)) {
      missing('RECAPTCHA_SECRET_KEY', 'Set RECAPTCHA_SITE_KEY and RECAPTCHA_SECRET_KEY together, or neither.');
    }
    if (env.APP_ENV !== 'local' && env.FORMS_IP_SALT === undefined) {
      missing('FORMS_IP_SALT', `FORMS_IP_SALT is required in ${env.APP_ENV}. Generate one: \`openssl rand -hex 32\`.`);
    }
    if (env.LOAD_TIMING === 'on' && env.APP_ENV !== 'local') {
      missing(
        'LOAD_TIMING',
        `LOAD_TIMING=on is refused in ${env.APP_ENV}: the timing header is for the local load stack only.`,
      );
    }
    if (!oneLabelAllowed(env) && isComposeServiceUrl(env.WORKER_INTERNAL_URL)) {
      missing('WORKER_INTERNAL_URL', composeOnlyLocally('WORKER_INTERNAL_URL', env.APP_ENV));
    }
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
    // Without them the relay stays dormant after a write, and changes wait for the next poke. A Vercel Function has
    // no worker to poke (spec 0045): its writes start the job drain instead, and live updates are off.
    if (env.WORKER_INTERNAL_URL === undefined && !onVercel(env)) {
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
    // Unset turns live updates off (the token procedures answer 503), in production too, so the API can ship
    // before the secret is set; a set secret must be a real one.
    if (env.CENTRIFUGO_TOKEN_SECRET === LOCAL_CENTRIFUGO_TOKEN_SECRET) {
      missing('CENTRIFUGO_TOKEN_SECRET', "That is the local secret. Use the Centrifugo service's token secret.");
    } else if (env.CENTRIFUGO_TOKEN_SECRET !== undefined && env.CENTRIFUGO_TOKEN_SECRET.length < 32) {
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
  .transform(({ CALENDAR_TOKEN_KEY, GOOGLE_CALENDAR_CLIENT_SECRET, MICROSOFT_CLIENT_SECRET, ...env }) => ({
    ...env,
    MAIL_FROM: namedSender(env.MAIL_FROM ?? DEFAULT_LOCAL_SENDER),
    // Mailpit is a laptop's inbox; a deployed API never sends there.
    MAILPIT_URL: env.APP_ENV === 'local' ? env.MAILPIT_URL : undefined,
    // Calendar sync (spec 0024), when on: the key and the secrets live only in here, the key decoded.
    calendar: calendarOf({ ...env, CALENDAR_TOKEN_KEY, GOOGLE_CALENDAR_CLIENT_SECRET, MICROSOFT_CLIENT_SECRET }),
  }));
export type ApiEnv = z.infer<typeof ApiEnv>;

/**
 * The api's own variables as a Vercel Function (spec 0045), beside `ApiEnv`:
 * the job drain's direct login (the worker's `crm_worker_user`, never Neon's
 * pooler) and the jobs endpoint's shared secret, both required outside
 * local; and `CRON_SECRET`, optional everywhere: set, Vercel Cron's `GET` of
 * the jobs endpoint runs a turn (it sends `Authorization: Bearer
 * <CRON_SECRET>`); unset, that `GET` answers 404.
 */
export const FunctionEnv = z
  .object({
    APP_ENV: AppEnvironment,
    DATABASE_URL_DIRECT: optional(z.url()),
    // `POST /api/internal/jobs/run` takes it in a header (the scheduled run in jobs.yml sends it); a header carries
    // it, so printable ASCII with no spaces, like the edge secret.
    JOBS_RUN_SECRET: optional(
      z
        .string()
        .min(32, 'JOBS_RUN_SECRET must be at least 32 characters.')
        .regex(/^[\x21-\x7e]+$/, 'JOBS_RUN_SECRET may hold only printable ASCII characters, with no spaces.'),
    ),
    // Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>` on its `GET /api/internal/jobs/run`; the same
    // rules as JOBS_RUN_SECRET. Only a project with a frequent cron sets it (Timefix's; brij-crm, on Hobby, can't).
    CRON_SECRET: optional(
      z
        .string()
        .min(32, 'CRON_SECRET must be at least 32 characters.')
        .regex(/^[\x21-\x7e]+$/, 'CRON_SECRET may hold only printable ASCII characters, with no spaces.'),
    ),
  })
  .superRefine((env, issues) => {
    if (env.APP_ENV === 'local') return;
    const missing = (path: string, message: string) => issues.addIssue({ code: 'custom', path: [path], message });
    if (env.DATABASE_URL_DIRECT === undefined) {
      missing(
        'DATABASE_URL_DIRECT',
        `DATABASE_URL_DIRECT is required in ${env.APP_ENV}: the worker login's direct address, which runs the jobs.`,
      );
    }
    if (env.JOBS_RUN_SECRET === undefined) {
      missing('JOBS_RUN_SECRET', `JOBS_RUN_SECRET is required in ${env.APP_ENV}: the scheduled job run sends it.`);
    } else if (env.JOBS_RUN_SECRET.includes(LOCAL_SECRET_MARKER)) {
      missing('JOBS_RUN_SECRET', 'That is a local placeholder. Generate one: `openssl rand -hex 32`.');
    }
    if (env.CRON_SECRET?.includes(LOCAL_SECRET_MARKER) === true) {
      missing('CRON_SECRET', 'That is a local placeholder. Generate one: `openssl rand -hex 32`.');
    }
  });
export type FunctionEnv = z.infer<typeof FunctionEnv>;

/** A laptop's salt for hashed client addresses: never a deployed one (the env check requires a real one there). */
export const LOCAL_FORMS_IP_SALT = 'local-only-forms-ip-salt-not-for-deployment';

/** Whether signed in requests wake the worker (spec 0008): `WORKER_WAKE_ON_USE`, else on outside production. */
export function wakesOnUse(env: Pick<ApiEnv, 'APP_ENV' | 'WORKER_WAKE_ON_USE'>): boolean {
  return (env.WORKER_WAKE_ON_USE ?? (env.APP_ENV === 'production' ? 'off' : 'on')) === 'on';
}

const port = z.coerce.number().int().positive();

/** The worker's idle time before it sleeps (spec 0008): the relay's 3 quiet minutes from spec 0005. */
export const DEFAULT_IDLE_SLEEP_SECONDS = 180;

export const WorkerEnv = z
  .object({
    ...shared,
    // Locally the api owns PORT, so the worker uses WORKER_PORT. Deployed, each
    // service gets its own PORT, which the health check and the wake call reach.
    WORKER_PORT: port.optional(),
    PORT: port.optional(),
    DATABASE_URL_DIRECT: z.url(),
    // The relay publishes to Centrifugo's server API (spec 0005): its internal port (9000), and its HTTP API key.
    // Both or neither; required outside local. Locally, without them the worker boots with the relay off.
    CENTRIFUGO_API_URL: optional(internalUrl('CENTRIFUGO_API_URL')),
    CENTRIFUGO_API_KEY: optional(z.string()),
    // The api's poke must carry it (spec 0005). Required outside local; locally, unset takes any poke.
    WORKER_WAKE_SECRET: wakeSecret,
    // Booking emails (spec 0025, milestone 2): the app's address for their links, the guest page key, and the mail
    // transport the api uses (Resend, or Mailpit locally). Without APP_URL and a transport, booking mail is off and
    // each queued email is logged and dropped.
    APP_URL: optional(z.url()),
    // Where the public booking pages are served, when not on APP_URL: the guest page and Book again links.
    BOOKING_PUBLIC_ORIGIN: optional(publicOrigin),
    BOOKING_LINK_SECRET: bookingLinkSecret,
    RESEND_API_KEY: optional(z.string()),
    MAIL_FROM: optional(sender),
    MAILPIT_URL: optional(z.url()),
    // The background jobs' runners (spec 0008): `on` or `off`. Unset is `on` locally and in previews and `off` in
    // production, where Graphile's LISTEN and poll would keep Neon's compute awake until milestone 3's sleep lands.
    JOBS_RUNNER: optional(z.enum(['on', 'off'])),
    // Spec 0008's sleep: seconds with no work before the worker (runners and relay) closes every connection, so
    // Neon's compute can suspend; 180 when unset, 0 never sleeps (a paid plan, or debugging). Only with the jobs on.
    WORKER_IDLE_SLEEP_SECONDS: optional(z.coerce.number().int().min(0).max(86_400)),
    ...calendarFields,
  })
  .superRefine((env, issues) => {
    const missing = (path: string, message: string) => issues.addIssue({ code: 'custom', path: [path], message });
    checkCalendar(env, missing);
    const url = env.CENTRIFUGO_API_URL === undefined;
    const key = env.CENTRIFUGO_API_KEY === undefined;
    // As on the api: `local` relaxes the key, the wake secret and the address checks, so a production build never
    // runs with it.
    if (env.APP_ENV === 'local' && env.NODE_ENV === 'production') {
      missing('APP_ENV', 'APP_ENV=local is refused when NODE_ENV=production. Set APP_ENV to preview or production.');
    }
    if (url !== key)
      missing('CENTRIFUGO_API_KEY', 'Set CENTRIFUGO_API_URL and CENTRIFUGO_API_KEY together, or neither.');
    if (env.APP_ENV !== 'local' && url) {
      missing('CENTRIFUGO_API_URL', `CENTRIFUGO_API_URL is required in ${env.APP_ENV}: the relay publishes there.`);
    }
    if (!oneLabelAllowed(env) && isComposeServiceUrl(env.CENTRIFUGO_API_URL)) {
      missing('CENTRIFUGO_API_URL', composeOnlyLocally('CENTRIFUGO_API_URL', env.APP_ENV));
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
  .transform(
    ({
      WORKER_PORT,
      PORT,
      CENTRIFUGO_API_URL,
      CENTRIFUGO_API_KEY,
      JOBS_RUNNER,
      CALENDAR_TOKEN_KEY,
      GOOGLE_CALENDAR_CLIENT_SECRET,
      MICROSOFT_CLIENT_SECRET,
      ...rest
    }) => ({
      ...rest,
      // Calendar sync (spec 0024), when on: the worker refreshes tokens and syncs.
      calendar: calendarOf({ ...rest, CALENDAR_TOKEN_KEY, GOOGLE_CALENDAR_CLIENT_SECRET, MICROSOFT_CLIENT_SECRET }),
      WORKER_PORT: WORKER_PORT ?? PORT ?? 3001,
      JOBS_RUNNER: JOBS_RUNNER ?? (rest.APP_ENV === 'production' ? 'off' : 'on'),
      WORKER_IDLE_SLEEP_SECONDS: rest.WORKER_IDLE_SLEEP_SECONDS ?? DEFAULT_IDLE_SLEEP_SECONDS,
      MAIL_FROM: namedSender(rest.MAIL_FROM ?? DEFAULT_LOCAL_SENDER),
      // Mailpit is a laptop's inbox; a deployed worker never sends there.
      MAILPIT_URL: rest.APP_ENV === 'local' ? rest.MAILPIT_URL : undefined,
      // The relay's Centrifugo, when it is on.
      centrifugo:
        CENTRIFUGO_API_URL === undefined || CENTRIFUGO_API_KEY === undefined
          ? undefined
          : { apiUrl: CENTRIFUGO_API_URL, apiKey: CENTRIFUGO_API_KEY },
    }),
  );
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
