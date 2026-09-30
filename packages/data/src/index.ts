import type { contract } from '@crm/contracts';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';

export type { SystemStatus } from '@crm/contracts';

type ApiClient = ContractRouterClient<typeof contract>;

export interface DataLayerOptions {
  /** The app's own origin. The API sits under `/api` on it. */
  origin: string;
}

/**
 * The one client data layer. Screens read and write through it and never call
 * the network themselves. The record store, optimistic writes and live patches
 * are designed in Client data and state (#6) and land behind this interface.
 */
export function createDataLayer({ origin }: DataLayerOptions) {
  const api: ApiClient = createORPCClient(new RPCLink({ url: new URL('/api/rpc', origin).href }));

  return {
    system: {
      status: () => api.system.status(),
    },
  };
}

export type DataLayer = ReturnType<typeof createDataLayer>;
