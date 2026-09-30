import { randomUUID } from 'node:crypto';
import pg from 'pg';

const LISTEN_CHECK_TIMEOUT_MS = 2_000;

/**
 * Neon's pooled hosts carry `-pooler` in the name. LISTEN through a
 * transaction pooler is accepted and never delivers, so refuse it early.
 */
export function assertDirectUrl(url: string, variable: string): void {
  if (new URL(url).hostname.includes('-pooler')) {
    throw new Error(`${variable} points at the Neon pooler. Use the direct connection string.`);
  }
}

/**
 * Opens a direct (unpooled) connection for LISTEN, the outbox relay and jobs.
 * Before handing it over, it proves a NOTIFY from a second session arrives.
 * Through a transaction pooler it never does, so the process refuses to start.
 */
export async function openDirectConnection(options: {
  url: string;
  applicationName: string;
  variable?: string;
}): Promise<pg.Client> {
  const variable = options.variable ?? 'DATABASE_URL_DIRECT';
  assertDirectUrl(options.url, variable);

  const listener = new pg.Client({ connectionString: options.url, application_name: options.applicationName });
  await listener.connect();
  try {
    await assertListenDelivers(listener, options.url, variable);
  } catch (error) {
    await listener.end();
    throw error;
  }
  return listener;
}

async function assertListenDelivers(listener: pg.Client, url: string, variable: string): Promise<void> {
  const channel = `crm_listen_check_${randomUUID().replaceAll('-', '')}`;
  await listener.query(`listen ${channel}`);

  const delivered = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      listener.off('notification', onNotification);
      resolve(false);
    }, LISTEN_CHECK_TIMEOUT_MS);
    function onNotification(message: pg.Notification) {
      if (message.channel !== channel) return;
      clearTimeout(timer);
      listener.off('notification', onNotification);
      resolve(true);
    }
    listener.on('notification', onNotification);
  });

  const sender = new pg.Client({ connectionString: url, application_name: 'crm-listen-check' });
  await sender.connect();
  try {
    await sender.query('select pg_notify($1, $2)', [channel, 'ok']);
  } finally {
    await sender.end();
  }

  const ok = await delivered;
  await listener.query(`unlisten ${channel}`);
  if (!ok) {
    throw new Error(
      `LISTEN on ${variable} did not receive a NOTIFY within ${LISTEN_CHECK_TIMEOUT_MS}ms. ` +
        'It is probably a pooled (PgBouncer) connection; use the direct one.',
    );
  }
}
