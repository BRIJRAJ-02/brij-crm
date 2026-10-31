// One check of a custom domain (spec 0064, AC-6403 to AC-6405, AC-6408): the `crm_domains_check` job and Check now
// both run it, with the scope each has (the system's in the job, the owner's own for Check now). It looks up the
// ownership TXT record, claims the host in the database the first time that record is found (so a host two people
// asked for goes to whoever proved it, and nothing reaches Vercel before that), then adds the host to the Vercel
// project (an apex with `www` beside it, AC-6405) and reads how it stands. Core decides what that means
// (`decideCheck`) and saves it, queueing the next check. A removed domain is taken out of the project instead.
// The calls to Vercel and the DNS lookup run outside every transaction.
import {
  decideCheck,
  markDomainDetached,
  ownershipValue,
  readDomainForCheck,
  saveDomainCheck,
  wwwOf,
  type CheckObservation,
  type DomainRow,
  type VercelHostView,
} from '@crm/core';
import { Resolver } from 'node:dns/promises';
import { vercelDomainSettings } from '../../env.ts';
import { errorFields } from '../../log.ts';
import { createVercelDomains, type VercelDomains } from '../../vendors/vercel-domains.ts';

/** A scope the door made: the owner's own, or the system's in the job. */
export type CheckScope = Parameters<typeof readDomainForCheck>[0];

/** A TXT lookup, as `node:dns/promises`' `resolveTxt` answers it: each record's chunks. */
export type ResolveTxt = (name: string) => Promise<string[][]>;

/** What a check needs: Vercel, a TXT lookup, the log, and the clock. */
export interface DomainCheckDeps {
  readonly vercel: VercelDomains;
  readonly resolveTxt: ResolveTxt;
  readonly log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
  };
  readonly now?: () => Date;
}

/** DNS answers that mean "no such record", as against a lookup that failed. */
const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN']);

/** Whether the ownership TXT record holds this domain's token. */
async function lookTxt(deps: DomainCheckDeps, row: DomainRow): Promise<CheckObservation['txt']> {
  const wanted = ownershipValue(row.verifyToken);
  try {
    const records = await deps.resolveTxt(`_timefix.${row.host}`);
    return records.some((chunks) => chunks.join('').trim() === wanted) ? 'found' : 'missing';
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    return NO_RECORD.has(code) ? 'missing' : 'unknown';
  }
}

/** The host in the project (with `www` beside an apex), then how it stands; `unknown` when Vercel couldn't be read. */
async function lookVercel(deps: DomainCheckDeps, row: DomainRow): Promise<VercelHostView | 'unknown'> {
  try {
    let seen = await deps.vercel.read(row.host);
    if (!seen.attached) {
      await deps.vercel.attach(row.host);
      if (row.kind === 'apex') await deps.vercel.attach(wwwOf(row.host), row.host);
      seen = await deps.vercel.read(row.host);
    }
    return seen;
  } catch (error) {
    deps.log.warn('domains.check.vercel_failed', { domainId: row.id, ...errorFields(error) });
    return 'unknown';
  }
}

/** Takes a removed domain (and an apex's `www`) out of the project, once. Throws for a retry when Vercel fails. */
async function detach(deps: DomainCheckDeps, scope: CheckScope, row: DomainRow): Promise<void> {
  if (row.verifiedAt === undefined || row.detachedAt !== undefined) return;
  await deps.vercel.detach(row.host);
  if (row.kind === 'apex') await deps.vercel.detach(wwwOf(row.host));
  await markDomainDetached(scope, row.id);
  deps.log.info('domains.detached', { domainId: row.id, host: row.host });
}

/**
 * One check of one domain, answering the row after it (undefined when the scope reaches no such domain). A removed
 * domain is detached from Vercel; a failed one is left alone (Try again starts it waiting first).
 */
export async function checkDomain(
  deps: DomainCheckDeps,
  scope: CheckScope,
  domainId: string,
): Promise<DomainRow | undefined> {
  const now = deps.now ?? (() => new Date());
  let row = await readDomainForCheck(scope, domainId);
  if (row === undefined) return undefined;
  if (row.status === 'removed') {
    await detach(deps, scope, row);
    return row;
  }
  if (row.status === 'failed') return row;
  const txt = await lookTxt(deps, row);
  if (row.verifiedAt === undefined && txt !== 'found') {
    const saved = await saveDomainCheck(scope, row.id, decideCheck(row, { txt }, now()));
    deps.log.info('domains.check', { domainId: row.id, host: row.host, status: saved?.status, txt });
    return saved;
  }
  if (row.verifiedAt === undefined) {
    // Claimed here first: the host is this page's before anything reaches Vercel, or it was another's (failed).
    const claimed = await saveDomainCheck(scope, row.id, decideCheck(row, { txt, vercel: 'unknown' }, now()));
    if (claimed === undefined || claimed.status === 'failed') {
      deps.log.info('domains.check', {
        domainId: row.id,
        host: row.host,
        status: claimed?.status,
        problem: claimed?.problem,
      });
      return claimed;
    }
    row = claimed;
  }
  const vercel = await lookVercel(deps, row);
  const saved = await saveDomainCheck(scope, row.id, decideCheck(row, { txt, vercel }, now()));
  deps.log.info('domains.check', {
    domainId: row.id,
    host: row.host,
    status: saved?.status,
    ...(saved?.problem === undefined ? {} : { problem: saved.problem }),
  });
  return saved;
}

/** How long one TXT lookup may take, each of two tries. */
const TXT_TIMEOUT_MS = 3000;

/**
 * The checks' dependencies from the environment: Vercel's wrapper with the Vercel domain settings, and the system's
 * resolver for the TXT lookup. Undefined while the settings are unset (AC-6409): the feature is off, and says so
 * once, never inventing a value in their place.
 */
export function createDomainChecks(
  env: Parameters<typeof vercelDomainSettings>[0],
  log: DomainCheckDeps['log'],
): DomainCheckDeps | undefined {
  const vercel = createVercelDomains(vercelDomainSettings(env));
  if (vercel === undefined) {
    log.info('domains.off', { reason: 'VERCEL_DOMAINS_TOKEN or VERCEL_PROJECT_ID is not set' });
    return undefined;
  }
  const resolver = new Resolver({ timeout: TXT_TIMEOUT_MS, tries: 2 });
  return { vercel, resolveTxt: (name) => resolver.resolveTxt(name), log };
}
