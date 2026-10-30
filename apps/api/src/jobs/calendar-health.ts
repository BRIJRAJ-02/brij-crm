// Calendar health emails (spec 0037, job J8, AC-1310 and AC-1311).
//
// The sweep, `crm_cron_calendar_health`, is a crontab line on the light
// runner every 15 minutes with 15 minutes of fill (`graphile.ts` holds the
// task, as the one `graphile-worker` import). Where a worker runs, it fires on
// the quarter hour; on Vercel there is no worker, so it fires in the first job
// drain turn after each quarter hour: Timefix's Vercel Cron starts one every 15
// minutes, and brij-crm, on Hobby with no Vercel Cron, has the hourly
// scheduled turn (`.github/workflows/jobs.yml`) plus the turn every request
// starts, so there it runs at least once an hour. Graphile's known crontab row
// keeps one run per slot however many turns start. The window its newly
// broken count reads is an hour, the slowest floor, so a provider's outage is
// weighed whole wherever it runs.
//
// The sweep reads, on the worker's own login, the connections owed an email
// (`crm_calendar_health_candidates`, ids and counts only), holds them all when
// the newly broken look like an outage (one warning to Sentry, the next sweep
// decides again), and otherwise queues at most 200 `crm_calendar_health_email`
// jobs. Each runs `runCalendarHealthEmail` as the system in its workspace,
// which queues the email through the workspace email queue (`crm_email` sends
// it) and marks the episode in one transaction.
import { runCalendarHealthEmail, type systemScope } from '@crm/core/system';
import * as z from 'zod';

/** The sweep's task on Graphile's queue: the crontab line's. */
export const CALENDAR_HEALTH_TASK = 'crm_cron_calendar_health';

/** One episode's email's task. */
export const CALENDAR_HEALTH_EMAIL_TASK = 'crm_calendar_health_email';

/**
 * The crontab line: every 15 minutes, with 15 minutes of fill (a drain turn after the slot runs it once), its own
 * identifier, and 3 tries.
 */
export const CALENDAR_HEALTH_CRONTAB = `*/15 * * * * ${CALENDAR_HEALTH_TASK} ?fill=15m&id=calendar_health&max=3`;

/** One email job's payload: ids, the episode's start and which email. */
export const CalendarHealthEmailPayload = z.strictObject({
  workspaceId: z.uuid(),
  connectionId: z.uuid(),
  episode: z.string().min(1).max(64),
  reminder: z.boolean(),
});
/** One email job's payload. */
export type CalendarHealthEmailPayload = z.infer<typeof CalendarHealthEmailPayload>;

/** An email job's key: the connection, the episode and which email, so a sweep that runs twice queues one. */
export function calendarHealthEmailKey(payload: CalendarHealthEmailPayload): string {
  // The episode as Postgres wrote it, to the microsecond, digits only.
  const episode = payload.episode.replace(/\D/g, '');
  return `crm-calendar-health:${payload.workspaceId}:${payload.connectionId}:${episode}:${
    payload.reminder ? 'reminder' : 'first'
  }`;
}

/** What the email task needs: the system's scope in a workspace, and the log. */
export interface CalendarHealthDeps {
  readonly systemScope: (workspaceId: string) => ReturnType<typeof systemScope>;
  readonly log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
  };
}

/** One episode's first email or reminder, when still owed; a failure throws for Graphile's retry. */
export async function runCalendarHealthEmailTask(deps: CalendarHealthDeps, payload: unknown): Promise<void> {
  const parsed = CalendarHealthEmailPayload.safeParse(payload);
  if (!parsed.success) {
    deps.log.warn('calendar.health.payload_invalid', {});
    return;
  }
  const { workspaceId, connectionId, episode, reminder } = parsed.data;
  const outcome = await runCalendarHealthEmail(deps.systemScope(workspaceId), { connectionId, episode, reminder });
  // A refused email (params its template doesn't take) is a fault to see, never silence.
  const fields = { workspaceId, connectionId, reminder, outcome };
  if (outcome === 'refused') deps.log.warn('calendar.health.email', fields);
  else deps.log.info('calendar.health.email', fields);
}
