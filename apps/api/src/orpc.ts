import { type AppEnvironment, contract } from '@crm/contracts';
import type { Database } from '@crm/db';
import { implement } from '@orpc/server';

/** What every procedure receives. The actor and workspace join with sign in. */
export interface RequestContext {
  db: Database;
  environment: AppEnvironment;
}

export const base = implement(contract).$context<RequestContext>();
