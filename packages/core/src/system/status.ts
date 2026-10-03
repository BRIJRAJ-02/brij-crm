import type { AppEnvironment, SignInProviders, SystemStatus } from '@crm/contracts';
import type { Database } from '@crm/db';

/** What the status check needs: the database to ping, where it runs, and the sign in methods configured. */
export interface SystemDeps {
  db: Database;
  environment: AppEnvironment;
  providers: SignInProviders;
}

/** The status screen's answer: the environment, the database's version and latency, and the sign in methods. */
export async function getSystemStatus({ db, environment, providers }: SystemDeps): Promise<SystemStatus> {
  const database = await db.checkHealth();
  return { environment, database, providers, checkedAt: new Date().toISOString() };
}
