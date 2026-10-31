// A link page's custom domain (spec 0064, slice 1): the caller's own page only, behind the member door. The host
// rules and the records are core's; Vercel is reached only through the one wrapper, and only once the host is proved
// (`check.ts`). Off where this deployment has no Vercel domain settings: `get` says so and the card is hidden.
import {
  addMyDomain,
  CHECK_NOW_EVERY_SECONDS,
  domainViewOf,
  getMyDomain,
  normaliseHost,
  recordsFor,
  removeMyDomain,
  restartDomain,
  markDomainDetached,
  wwwOf,
  type NormalHost,
} from '@crm/core';
import type { DnsRecord } from '@crm/contracts';
import { apiError } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { errorFields, log } from '../../log.ts';
import { member, type RequestContext } from '../../orpc.ts';
import { checkDomain, type DomainCheckDeps } from './check.ts';

/** Adds one person may make in a day (spec 0064's API table). */
const ADDS_A_DAY = 10;
const DAY = 86_400;

const OFF = 'Custom domains aren’t set up here.';
const ADDS_SPENT = 'You’ve added a few domains today. Try again tomorrow.';
const CHECKED_NOW = 'Checked just now. Try again in a few seconds.';
const NO_DOMAIN = 'There’s no such domain on your page.';

/** The feature's dependencies, or the plain refusal where it is off. */
function domainsOn(context: Pick<RequestContext, 'domainChecks'>): DomainCheckDeps {
  if (context.domainChecks === undefined) throw apiError('API_UNAVAILABLE', OFF);
  return context.domainChecks;
}

/** Our own hosts, which are never anyone's custom domain (AC-6401): the app's and every public origin's. */
function ownHosts(context: Pick<RequestContext, 'publicOrigins' | 'bookingOrigin' | 'appUrl'>): readonly string[] {
  return [...context.publicOrigins, context.bookingOrigin, context.appUrl].flatMap((origin) =>
    URL.canParse(origin) ? [new URL(origin).hostname] : [],
  );
}

/** The routing records Vercel recommends for a host it doesn't hold yet; none when it couldn't be read. */
async function recommendedRecords(deps: DomainCheckDeps, host: NormalHost): Promise<readonly DnsRecord[]> {
  try {
    const routing = await deps.vercel.recommended(host.host);
    const view = { attached: false, verified: true, misconfigured: true, verification: [], ...routing };
    return recordsFor({ host: host.host, kind: host.kind, records: [], verifyToken: '0'.repeat(32) }, view).filter(
      (record) => record.purpose === 'routing',
    );
  } catch (error) {
    log.warn('domains.recommended_failed', errorFields(error));
    return [];
  }
}

export const domainsRouter = member.domains.router({
  get: member.domains.get.handler(async ({ context }) => {
    if (context.domainChecks === undefined) return { available: false as const };
    const domain = await getMyDomain(context.scope);
    return { available: true as const, ...(domain === undefined ? {} : { domain }) };
  }),
  add: member.domains.add.handler(async ({ context, input }) => {
    const deps = domainsOn(context);
    const checked = normaliseHost(input.host, ownHosts(context));
    if (!checked.ok) throw apiError('CONFIG_INVALID', checked.message);
    const spent = await context.limiter.consumeRateLimit(`domain-add:${context.user.id}`, {
      window: DAY,
      max: ADDS_A_DAY,
    });
    if (!spent.allowed) throw apiError('RATE_LIMITED', ADDS_SPENT);
    const routing = await recommendedRecords(deps, checked);
    return commitWrite(context, { mutationId: input.mutationId }, () =>
      addMyDomain(context.scope, { host: checked, routing }),
    );
  }),
  /** Check now (AC-6403): one check at once, at most every 10 seconds a domain; a failed one is tried again. */
  check: member.domains.check.handler(async ({ context, input }) => {
    const deps = domainsOn(context);
    const spent = await context.limiter.consumeRateLimit(`domain-check:${context.user.id}:${input.domainId}`, {
      window: CHECK_NOW_EVERY_SECONDS,
      max: 1,
    });
    if (!spent.allowed) throw apiError('RATE_LIMITED', CHECKED_NOW);
    return commitWrite(context, { mutationId: input.mutationId }, async () => {
      await restartDomain(context.scope, input.domainId);
      const row = await checkDomain(deps, context.scope, input.domainId);
      if (row === undefined || row.status === 'removed') throw apiError('NOT_FOUND', NO_DOMAIN);
      return domainViewOf(row);
    });
  }),
  /** Removes it from the page at once, and from the Vercel project at once too, else by the queued retry (AC-6408). */
  remove: member.domains.remove.handler(async ({ context, input }) => {
    const deps = domainsOn(context);
    return commitWrite(context, { mutationId: input.mutationId }, async () => {
      const removed = await removeMyDomain(context.scope, input.domainId);
      if (removed === undefined) throw apiError('NOT_FOUND', NO_DOMAIN);
      if (removed.attached) {
        try {
          await deps.vercel.detach(removed.host);
          if (removed.kind === 'apex') await deps.vercel.detach(wwwOf(removed.host));
          await markDomainDetached(context.scope, input.domainId);
        } catch (error) {
          // The host already serves nothing; the queued check takes it out of the project in two minutes.
          log.warn('domains.detach_failed', { domainId: input.domainId, ...errorFields(error) });
        }
      }
      return { id: input.domainId };
    });
  }),
});
