import type { AppEnvironment, SignInProviders, SystemStatus } from '@crm/contracts';
import type { Database } from '@crm/db';

/** What the status check needs: the database to ping, where it runs, the sign in methods configured, and calendar sync. */
export interface SystemDeps {
  db: Database;
  environment: AppEnvironment;
  providers: SignInProviders;
  /** Whether calendar sync is set up here (`CALENDAR_SYNC=on`). */
  calendarSync: boolean;
}

/** The status screen's answer: the environment, the database's version and latency, the sign in methods and calendar sync. */
export async function getSystemStatus({ db, environment, providers, calendarSync }: SystemDeps): Promise<SystemStatus> {
  const database = await db.checkHealth();
  return { environment, database, providers, calendarSync, checkedAt: new Date().toISOString() };
}
