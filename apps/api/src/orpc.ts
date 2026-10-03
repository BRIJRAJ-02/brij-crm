import { type AppEnvironment, contract } from '@crm/contracts';
import type { Database } from '@crm/db';
import { implement } from '@orpc/server';
import type { ResponseHeadersPluginContext } from '@orpc/server/plugins';

/** What every procedure receives. The actor and workspace join with sign in. */
export interface RequestContext extends ResponseHeadersPluginContext {
  db: Database;
  environment: AppEnvironment;
  /** This request's id, also sent back as `x-request-id`; every log line about the request carries it. */
  requestId: string;
  /** The caller's IP, only when the edge guard trusted the request (see `edge.ts`). */
  clientIp: string | undefined;
}

export const base = implement(contract).$context<RequestContext>();
