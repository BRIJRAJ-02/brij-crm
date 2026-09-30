import type { AppEnvironment, SystemStatus } from '@crm/contracts';
import type { Database } from '@crm/db';

export interface SystemDeps {
  db: Database;
  environment: AppEnvironment;
}

export async function getSystemStatus({ db, environment }: SystemDeps): Promise<SystemStatus> {
  const database = await db.checkHealth();
  return { environment, database, checkedAt: new Date().toISOString() };
}
