// The free email domains (spec 0024, AC-607; the list spec 0023 names): an
// attendee at gmail.com names no company. The one module that reads the
// `free-email-domains` package, loaded once, as the plain JSON list it ships
// (its install script, which would fetch a fresh list from the network, never
// runs: pnpm refuses it, see `pnpm-workspace.yaml`). The pinned version is
// refreshed by a dependency update. A static import, so a bundler's file
// trace (the Vercel Function, spec 0045) ships the list with the code.
import domainList from 'free-email-domains/domains.json' with { type: 'json' };

/** Whether a domain list loaded from the package is one: an array of strings. */
function isDomainList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((domain) => typeof domain === 'string');
}

/** Loads the list and answers whether a domain (lower case) is a free email domain. */
export function createFreeDomains(): (domain: string) => boolean {
  const list: unknown = domainList;
  if (!isDomainList(list)) throw new Error('The free email domain list is not a list of domains.');
  const domains = new Set(list.map((domain) => domain.trim().toLowerCase()));
  return (domain) => domains.has(domain.trim().toLowerCase());
}
