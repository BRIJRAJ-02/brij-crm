// Where a custom domain stands after a check (spec 0064, AC-6403, AC-6404, AC-6408): pure, so the job, Check now and
// the tests decide alike. A check looks up the ownership TXT record, and once that was found asks Vercel how the host
// stands in the project; this turns what it saw into the next status, the one line problem, the records the owner
// sets, and when to look again.
import type { DnsRecord, DomainStatus } from '@crm/contracts';
import { ownershipName, ownershipValue } from './hosts.ts';

/** How often a domain that isn't live is checked (AC-6403): every 15 minutes. */
export const CHECK_EVERY_SECONDS = 15 * 60;
/** How often a live domain is checked: once a day. */
export const LIVE_CHECK_EVERY_SECONDS = 24 * 60 * 60;
/** How long a domain waits for its TXT record before it fails (AC-6408). */
export const WAIT_FOR_TXT_MS = 7 * 24 * 60 * 60 * 1000;
/** How soon Check now may run again for one domain (AC-6403). */
export const CHECK_NOW_EVERY_SECONDS = 10;

/** Vercel's documented values for a host it serves, shown until its own read answers for this host. */
export const VERCEL_DEFAULT_CNAME = 'cname.vercel-dns.com';

/** A stored status: the card's five, and a removed domain's. */
export type StoredStatus = DomainStatus | 'removed';

/** The one lines a check can show (AC-6403, AC-6408). */
export const DOMAIN_PROBLEMS = {
  noTxt: 'We didn’t find the TXT record in 7 days.',
  cname: 'The CNAME points somewhere else.',
  aRecord: 'The A record points somewhere else.',
  vercel: 'Add the _vercel TXT record too.',
  inUse: 'That domain is already in use.',
} as const;

/** How a host stands in the Vercel project, as the wrapper's reads answer it. */
export interface VercelHostView {
  /** Whether the host is in the project at all. */
  readonly attached: boolean;
  /** False while Vercel wants its own `_vercel` TXT record (the host is in use on another Vercel account). */
  readonly verified: boolean;
  /** True while the host's DNS doesn't point at Vercel. */
  readonly misconfigured: boolean;
  /** The TXT records Vercel asks for before it verifies the host. */
  readonly verification: readonly { readonly name: string; readonly value: string }[];
  /** The CNAME target Vercel recommends for a subdomain. */
  readonly cname?: string;
  /** The A record values Vercel recommends for an apex. */
  readonly aValues?: readonly string[];
}

/** What a check saw: the TXT lookup, and Vercel's view once the host is proved (undefined before; `unknown` if it failed). */
export interface CheckObservation {
  readonly txt: 'found' | 'missing' | 'unknown';
  readonly vercel?: VercelHostView | 'unknown';
}

/** The parts of a domain row a check reads. */
export interface CheckedDomain {
  readonly host: string;
  readonly kind: 'apex' | 'subdomain';
  readonly status: StoredStatus;
  readonly verifyToken: string;
  readonly records: readonly DnsRecord[];
  readonly waitingSince: Date;
  readonly verifiedAt?: Date;
  readonly liveAt?: Date;
}

/** What a check decided. */
export interface CheckDecision {
  readonly status: StoredStatus;
  readonly problem?: string;
  /** The TXT record was found for the first time: the host is now this page's, and goes into the Vercel project. */
  readonly verifiedNow: boolean;
  /** The domain went live with this check. */
  readonly liveNow: boolean;
  readonly records: readonly DnsRecord[];
  /** When to check again, in seconds; undefined to stop (failed, or removed). */
  readonly nextInSeconds?: number;
}

/** The ownership record, always first (AC-6402). */
export function ownershipRecord(host: string, token: string): DnsRecord {
  return { type: 'TXT', name: ownershipName(host), value: ownershipValue(token), purpose: 'ownership' };
}

/**
 * The routing records for a host (AC-6402): what Vercel recommends for it (a CNAME for a subdomain, A records for an
 * apex), else what was shown before, else Vercel's documented CNAME for a subdomain. An apex with nothing from
 * Vercel yet shows no A record rather than a guessed one.
 */
function routingRecords(domain: Pick<CheckedDomain, 'host' | 'kind' | 'records'>, vercel?: VercelHostView) {
  if (vercel !== undefined) {
    if (domain.kind === 'subdomain' && vercel.cname !== undefined && vercel.cname !== '') {
      return [{ type: 'CNAME', name: domain.host, value: vercel.cname, purpose: 'routing' } satisfies DnsRecord];
    }
    if (domain.kind === 'apex' && vercel.aValues !== undefined && vercel.aValues.length > 0) {
      return vercel.aValues.map((value): DnsRecord => ({ type: 'A', name: domain.host, value, purpose: 'routing' }));
    }
  }
  const before = domain.records.filter((record) => record.purpose === 'routing');
  if (before.length > 0) return before;
  return domain.kind === 'subdomain'
    ? [{ type: 'CNAME', name: domain.host, value: VERCEL_DEFAULT_CNAME, purpose: 'routing' } satisfies DnsRecord]
    : [];
}

/** Every record the owner sets: ownership, routing, then Vercel's own TXT when it asks for one (AC-6402). */
export function recordsFor(
  domain: Pick<CheckedDomain, 'host' | 'kind' | 'records' | 'verifyToken'>,
  vercel?: VercelHostView,
): readonly DnsRecord[] {
  const own = ownershipRecord(domain.host, domain.verifyToken);
  const routing = routingRecords(domain, vercel);
  const asked =
    vercel === undefined
      ? domain.records.filter((record) => record.purpose === 'vercel')
      : vercel.verified
        ? []
        : vercel.verification.map((record): DnsRecord => ({
            type: 'TXT',
            name: record.name,
            value: record.value,
            purpose: 'vercel',
          }));
  return [own, ...routing, ...asked];
}

/**
 * The next state of a domain after a check (AC-6403, AC-6404, AC-6408).
 *
 * Before its TXT record is found a domain waits, checked every 15 minutes, and fails after 7 days. Once found it is
 * proved for good (a TXT record taken down later changes nothing), and it is Checking until Vercel reports it
 * verified and configured, when it is Live, checked daily. A live domain whose DNS later moves away needs attention,
 * with the one line saying what is wrong, and keeps being checked every 15 minutes until it is right again. A check
 * whose lookups failed changes nothing and looks again in 15 minutes.
 */
export function decideCheck(domain: CheckedDomain, seen: CheckObservation, now: Date): CheckDecision {
  const keep = (records = domain.records) => ({ verifiedNow: false, liveNow: false, records });
  if (domain.status === 'removed' || domain.status === 'failed') {
    return { status: domain.status, ...keep() };
  }
  const proved = domain.verifiedAt !== undefined || seen.txt === 'found';
  if (!proved) {
    const records = recordsFor(domain);
    if (now.getTime() - domain.waitingSince.getTime() >= WAIT_FOR_TXT_MS) {
      return { status: 'failed', problem: DOMAIN_PROBLEMS.noTxt, ...keep(records) };
    }
    return { status: 'waiting', ...keep(records), nextInSeconds: CHECK_EVERY_SECONDS };
  }
  const verifiedNow = domain.verifiedAt === undefined;
  const vercel = seen.vercel;
  if (vercel === undefined || vercel === 'unknown' || !vercel.attached) {
    // Proved, but Vercel's side wasn't read: as it was (Checking for a domain proved just now), and again soon.
    const status = verifiedNow || domain.status === 'waiting' ? 'checking' : domain.status;
    return { status, verifiedNow, liveNow: false, records: recordsFor(domain), nextInSeconds: CHECK_EVERY_SECONDS };
  }
  const records = recordsFor(domain, vercel);
  if (vercel.verified && !vercel.misconfigured) {
    return {
      status: 'live',
      verifiedNow,
      liveNow: domain.status !== 'live',
      records,
      nextInSeconds: LIVE_CHECK_EVERY_SECONDS,
    };
  }
  const problem = !vercel.verified
    ? DOMAIN_PROBLEMS.vercel
    : domain.kind === 'apex'
      ? DOMAIN_PROBLEMS.aRecord
      : DOMAIN_PROBLEMS.cname;
  // Never live yet: still being set up, so Checking, with Vercel's own record named if it wants one. Once it has been
  // live, anything wrong needs attention.
  const wasLive = domain.liveAt !== undefined;
  return {
    status: wasLive ? 'attention' : 'checking',
    ...(wasLive || !vercel.verified ? { problem } : {}),
    verifiedNow,
    liveNow: false,
    records,
    nextInSeconds: CHECK_EVERY_SECONDS,
  };
}
