// Custom domains for a link page (spec 0064, slice 1, AC-6401 to AC-6409): the owner's own host, the DNS records to
// set, and where its checks stand. The host rules themselves (normalising, refusing our own hosts) live in core, so
// the contract takes any short text and the service answers the one line refusal.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The longest host a person may type, before it is normalised (a host is at most 253 characters). */
export const DOMAIN_INPUT_MAX = 300;

/** Where a domain stands, as the Domain card shows it (AC-6403); `failed` waited seven days for its TXT record. */
export const DomainStatus = z.enum(['waiting', 'checking', 'live', 'attention', 'failed']);
/** Where a domain stands. */
export type DomainStatus = z.infer<typeof DomainStatus>;

/** `apex` for `janedoe.com` (with `www` redirected beside it, AC-6405), `subdomain` for `book.janedoe.com`. */
export const DomainKind = z.enum(['apex', 'subdomain']);
/** An apex or a subdomain. */
export type DomainKind = z.infer<typeof DomainKind>;

/**
 * One DNS record the owner sets (AC-6402): `ownership` is our `_timefix` TXT token, `routing` the CNAME or A record
 * Vercel asks for, and `vercel` Vercel's own `_vercel` TXT when the domain is in use on another Vercel account.
 */
export const DnsRecord = z.object({
  type: z.enum(['TXT', 'CNAME', 'A']),
  /** The full name, `_timefix.book.janedoe.com`; a DNS host's form may want only the part before the domain. */
  name: z.string().max(260),
  value: z.string().max(512),
  purpose: z.enum(['ownership', 'routing', 'vercel']),
});
/** One DNS record to set. */
export type DnsRecord = z.infer<typeof DnsRecord>;

/** A link page's custom domain, as its owner sees it. */
export const CustomDomain = z.object({
  id: Uuid,
  host: z.string(),
  kind: DomainKind,
  status: DomainStatus,
  /** The one line Needs attention (or a failed domain) shows, absent otherwise. */
  problem: z.string().optional(),
  /** Every record to set, the ownership TXT first. */
  records: z.array(DnsRecord),
  /** When it was last checked, ISO 8601. */
  checkedAt: z.iso.datetime({ offset: true }).optional(),
  /** When it went live, ISO 8601. */
  liveAt: z.iso.datetime({ offset: true }).optional(),
});
/** A link page's custom domain. */
export type CustomDomain = z.infer<typeof CustomDomain>;

/**
 * The Domain card's read (AC-6409): `available` is false where this deployment has no Vercel domain settings, and
 * the card is hidden; otherwise the page's domain, absent until one is added.
 */
export const DomainState = z.discriminatedUnion('available', [
  z.object({ available: z.literal(false) }),
  z.object({ available: z.literal(true), domain: CustomDomain.optional() }),
]);
/** The Domain card's read. */
export type DomainState = z.infer<typeof DomainState>;

/** Adding a domain to the caller's link page in this workspace. */
export const AddDomainInput = WorkspaceScoped.extend({
  host: z.string().trim().min(1, 'Enter a domain.').max(DOMAIN_INPUT_MAX, 'That domain is too long.'),
  mutationId: Uuid,
});
/** Adding a domain. */
export type AddDomainInput = z.infer<typeof AddDomainInput>;

/** One of the caller's domains, by id. */
export const DomainInput = WorkspaceScoped.extend({ domainId: Uuid, mutationId: Uuid });
/** One of the caller's domains. */
export type DomainInput = z.infer<typeof DomainInput>;

/** What `GET /api/public/domains/:host` answers for a live host: the handle whose page it serves (AC-6406). */
export const PublicDomainAnswer = z.object({ handle: z.string() });
/** The handle a live host serves. */
export type PublicDomainAnswer = z.infer<typeof PublicDomainAnswer>;

/** The caller's own link page's domain (spec 0064): read, add, check now, remove. */
export const domainsContract = {
  get: oc.input(WorkspaceScoped).output(DomainState),
  /**
   * Refused `CONFIG_INVALID` (bad or our own host), `IN_USE` (proved by another page), `LIMIT_REACHED` (the page has
   * one already) and `RATE_LIMITED` (10 adds a day). Spec 0064 names `CONFLICT`, which is no code of ours.
   */
  add: oc.input(AddDomainInput).output(CustomDomain),
  /** Check now (AC-6403): at most once every 10 seconds, else `RATE_LIMITED`. A failed domain starts waiting again. */
  check: oc.input(DomainInput).output(CustomDomain),
  /** Removes it from the page and the Vercel project at once (AC-6408). */
  remove: oc.input(DomainInput).output(z.object({ id: Uuid })),
};
