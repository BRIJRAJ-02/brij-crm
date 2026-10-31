// The one public read of a custom domain (spec 0064, AC-6404, AC-6406): which handle a host serves, through
// `crm_live_domain_handle` alone. It reaches across workspaces, so it names no workspace (the nil one, which no row
// has) and answers only a live, proved host's handle; every miss, however it missed, is the same undefined.
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import { normaliseHost } from './hosts.ts';

/** The nil uuid: a workspace no row has, for a read that finds its row by host. */
const NO_WORKSPACE = '00000000-0000-0000-0000-000000000000';

/** The handle a live custom host serves, or undefined. A host that isn't a host at all is a miss like any other. */
export async function liveDomainHandle(deps: { readonly db: Database }, host: string): Promise<string | undefined> {
  const checked = normaliseHost(host);
  if (!checked.ok || checked.host !== host) return undefined;
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ handle: string | null }>(sql`select crm_live_domain_handle(${checked.host}) as handle`),
  );
  return found.rows[0]?.handle ?? undefined;
}
