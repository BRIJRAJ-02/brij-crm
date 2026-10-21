// The notifications email task's edges (spec 0038): a payload that isn't ours
// is dropped without a retry, and with mail off the task completes quietly.
// The email's contents are core's `prepareNotificationEmail`, tested there
// against Postgres.
import { describe, expect, it } from 'vitest';
import type { ActorDoorDeps } from '@crm/core/system';
import { runNotificationEmail } from './notification-email.ts';

const lines: string[] = [];
const log = {
  info: (message: string) => lines.push(message),
  warn: (message: string) => lines.push(message),
};
// Never reached: both cases end before the database.
const door = {} as ActorDoorDeps;
const PAYLOAD = {
  workspaceId: '0199a6f2-0000-7000-8000-000000000001',
  memberId: '0199a6f2-0000-7000-8000-000000000002',
};

describe('the notifications email task', () => {
  it('drops a payload that isn’t ours, and skips with mail off', async () => {
    const sent: string[] = [];
    const mailer = {
      transport: 'mailpit' as const,
      send: (message: { readonly to: string }) => {
        sent.push(message.to);
        return Promise.resolve();
      },
    };
    await runNotificationEmail({ door, mailer, appOrigin: 'https://app.example.com', log }, { nope: true });
    await runNotificationEmail({ door, mailer: undefined, appOrigin: undefined, log }, PAYLOAD);
    expect(lines).toEqual(['notification.email.payload_invalid', 'notification.email.skipped']);
    expect(sent).toEqual([]);
  });
});
