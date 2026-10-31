// Vercel's Domains API (spec 0064, AC-6402, AC-6404, AC-6405, AC-6409): the one module that talks to Vercel about a
// custom domain. It adds a proved host to this deployment's own project (an apex with `www` beside it, redirected
// there with a 308), reads how the host stands (Vercel's own verification and whether the DNS points at it), and
// takes it out again. Plain `fetch` to Vercel's constant address, with the token from the environment
// (`VERCEL_DOMAINS_TOKEN`) in the Authorization header and nowhere else: never logged, never answered, never in an
// error's message. Every call gives up after 10 seconds. A refusal is thrown as `VercelDomainsError` with Vercel's
// status and code only.
import type { VercelHostView } from '@crm/core';
import type { VercelDomainSettings } from '../env.ts';

/** Vercel's API, a constant: a host a person typed is only ever a path segment here, encoded. */
export const VERCEL_API = 'https://api.vercel.com';

/** How long one call may take. */
export const VERCEL_TIMEOUT_MS = 10_000;

/** A Vercel call that failed: its status (0 for no answer) and Vercel's own error code, never its message. */
export interface VercelDomainsError extends Error {
  readonly name: 'VercelDomainsError';
  readonly status: number;
  readonly code: string;
}

/** Whether an error is one of this wrapper's. */
export function isVercelDomainsError(error: unknown): error is VercelDomainsError {
  return error instanceof Error && error.name === 'VercelDomainsError';
}

function vercelError(status: number, code: string): VercelDomainsError {
  return Object.assign(new Error(`Vercel answered ${String(status)} ${code}.`), {
    name: 'VercelDomainsError' as const,
    status,
    code,
  });
}

/** What the rest of the api asks of Vercel. */
export interface VercelDomains {
  /** Adds `host` to the project; with `redirectTo`, as a 308 to that host (`www` beside an apex). Already there is fine. */
  readonly attach: (host: string, redirectTo?: string) => Promise<void>;
  /** Takes `host` out of the project. Not there is fine. */
  readonly detach: (host: string) => Promise<void>;
  /** How `host` stands in the project and in DNS (AC-6403). */
  readonly read: (host: string) => Promise<VercelHostView>;
  /** The routing records Vercel recommends for `host`, before it is in the project (AC-6402). */
  readonly recommended: (host: string) => Promise<Pick<VercelHostView, 'cname' | 'aValues'>>;
}

/** What `fetch` does, for tests to stand in for. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** The lowest ranked value of Vercel's recommendations (`[{ rank, value }]`), as a list. */
function bestOf(recommended: unknown): readonly string[] {
  if (!Array.isArray(recommended)) return [];
  const ranked = recommended
    .flatMap((entry: unknown) => (isRecord(entry) ? [entry] : []))
    .sort((one, other) => Number(one.rank ?? 0) - Number(other.rank ?? 0));
  const value = ranked[0]?.value;
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.flatMap((item: unknown) => (typeof item === 'string' ? [item] : [])) : [];
}

/** The routing values of a domain config read: the CNAME target with any trailing dot, and the A values. */
function routingOf(config: unknown): Pick<VercelHostView, 'cname' | 'aValues'> {
  if (!isRecord(config)) return {};
  const cname = bestOf(config.recommendedCNAME)[0]?.replace(/\.$/, '');
  const aValues = bestOf(config.recommendedIPv4);
  return { ...(cname === undefined ? {} : { cname }), ...(aValues.length === 0 ? {} : { aValues }) };
}

/** Vercel's verification challenges on a project domain (`verification: [{ type, domain, value }]`), TXT only. */
function challengesOf(domain: unknown): VercelHostView['verification'] {
  if (!isRecord(domain) || !Array.isArray(domain.verification)) return [];
  return domain.verification.flatMap((entry: unknown) => {
    if (!isRecord(entry) || entry.type !== 'TXT') return [];
    const name = text(entry.domain);
    const value = text(entry.value);
    return name === undefined || value === undefined ? [] : [{ name, value }];
  });
}

/** The wrapper for one project, or undefined while the settings are unset (the feature is off, AC-6409). */
export function createVercelDomains(
  settings: VercelDomainSettings | undefined,
  options: { readonly fetch?: FetchLike } = {},
): VercelDomains | undefined {
  if (settings === undefined) return undefined;
  const send = options.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const project = encodeURIComponent(settings.projectId);
  const team = settings.teamId === undefined ? '' : `teamId=${encodeURIComponent(settings.teamId)}`;
  const address = (path: string, query = '') => {
    const both = [query, team].filter((part) => part !== '').join('&');
    return `${VERCEL_API}${path}${both === '' ? '' : `?${both}`}`;
  };

  /** One call: its JSON body (or undefined), and its status. Anything but a 2xx, a 404 or a 409 throws. */
  async function call(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<{ readonly status: number; readonly json: unknown }> {
    let answer: Response;
    try {
      answer = await send(url, {
        method,
        headers: {
          authorization: `Bearer ${settings.token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(VERCEL_TIMEOUT_MS),
      });
    } catch (error) {
      throw vercelError(0, error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unreachable');
    }
    const json: unknown = await answer.json().catch(() => undefined);
    if (answer.ok || answer.status === 404 || answer.status === 409) return { status: answer.status, json };
    const code = isRecord(json) && isRecord(json.error) ? (text(json.error.code) ?? 'error') : 'error';
    throw vercelError(answer.status, code.slice(0, 64));
  }

  const domainPath = (host: string) => `/v9/projects/${project}/domains/${encodeURIComponent(host)}`;

  return {
    async attach(host, redirectTo) {
      await call('POST', address(`/v10/projects/${project}/domains`), {
        name: host,
        ...(redirectTo === undefined ? {} : { redirect: redirectTo, redirectStatusCode: 308 }),
      });
    },
    async detach(host) {
      await call('DELETE', address(domainPath(host)));
    },
    async read(host) {
      const found = await call('GET', address(domainPath(host)));
      if (found.status === 404) return { attached: false, verified: false, misconfigured: true, verification: [] };
      let domain = found.json;
      // Unverified: ask Vercel to look again now, which answers the domain as it stands after looking.
      if (isRecord(domain) && domain.verified !== true) {
        const verified = await call('POST', address(`${domainPath(host)}/verify`));
        if (verified.status !== 404 && isRecord(verified.json) && 'verified' in verified.json) domain = verified.json;
      }
      const config = await call(
        'GET',
        address(`/v6/domains/${encodeURIComponent(host)}/config`, `projectIdOrName=${project}`),
      );
      const misconfigured = !isRecord(config.json) || config.json.misconfigured !== false;
      return {
        attached: true,
        verified: isRecord(domain) && domain.verified === true,
        misconfigured,
        verification: challengesOf(domain),
        ...routingOf(config.json),
      };
    },
    async recommended(host) {
      const config = await call(
        'GET',
        address(`/v6/domains/${encodeURIComponent(host)}/config`, `projectIdOrName=${project}`),
      );
      return routingOf(config.json);
    },
  };
}
