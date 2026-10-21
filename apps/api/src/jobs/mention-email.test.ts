// One mention, one email (spec 0038, AC-1176): a comment that mentions a
// member reaches them once, in the notifications email, and the workspace
// email queue holds nothing for it (the queue has no mention kind). The task
// run again sends nothing more; with the `mentions` topic turned off from an
// email's preferences link, a new mention sends nothing. Against the test
// database, with a fake mailer.
import { mentionToken } from '@crm/contracts';
import { createComment, createRecord, createWorkspace, newId, NO_RULE_SOURCE } from '@crm/core';
import { enterEmailLink, setEmailPreference } from '@crm/core/public';
import { testScope } from '@crm/core/testing';
import { createDatabase, type Database } from '@crm/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Mailer, MailMessage } from '../mail/mailer.ts';
import { runNotificationEmail } from './notification-email.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-mention-email-tests' });
});
afterAll(async () => {
  await db.close();
});

function fakeMailer(): Mailer & { readonly sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    transport: 'mailpit',
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

const quiet = { info: () => undefined, warn: () => undefined };

async function world() {
  const created = await createWorkspace(db, {
    name: 'Mentions',
    slug: `mention-email-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const { workspaceId } = created;
  const bea = newId();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(sql`
      insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
      values (${workspaceId}, ${bea}, 'Bea', 'bea@example.com', 'member', 'system', 'system')
    `),
  );
  const ada = testScope({ db, workspaceId, actor: { type: 'member', id: created.memberId } });
  const companies = created.objects.companies ?? '';
  const [name] = (
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute<{ id: string }>(
        sql`select id::text from attributes where object_id = ${companies}::uuid and api_slug = 'name'`,
      ),
    )
  ).rows;
  const { recordId } = await createRecord(ada, { objectId: companies, values: { [name?.id ?? '']: 'Northwind' } });
  const mention = () =>
    createComment(ada, { id: newId(), recordId, body: `Can you take the demo, ${mentionToken(bea)}?` });
  const queued = async () =>
    (
      await db.withWorkspace(workspaceId, (tx) =>
        tx.execute<{ kind: string }>(sql`select kind from emails where to_member_id = ${bea}::uuid`),
      )
    ).rows;
  const send = async (mailer: Mailer) =>
    runNotificationEmail(
      { door: { db, rules: NO_RULE_SOURCE }, mailer, appOrigin: 'https://app.example.com', log: quiet },
      { workspaceId, memberId: bea },
    );
  return { workspaceId, bea, mention, queued, send };
}

describe('a mention’s email', () => {
  it('is one email, the notifications email, however often the task runs, and none with the topic off', async () => {
    const w = await world();
    await w.mention();
    const mailer = fakeMailer();
    await w.send(mailer);
    await w.send(mailer);
    expect(mailer.sent.map((message) => message.to)).toEqual(['bea@example.com']);
    expect(mailer.sent[0]?.text).toContain('Ada mentioned you');
    // Nothing went the other way: the workspace email queue holds no email for the mention.
    expect(await w.queued()).toEqual([]);

    // Mentions turned off from an email's preferences link: the next mention is never emailed.
    const link = await enterEmailLink({ db }, { workspaceId: w.workspaceId, memberId: w.bea, topic: 'mentions' });
    await setEmailPreference(link, { topic: 'mentions', subscribed: false }, 'mentions');
    await w.mention();
    await w.send(mailer);
    expect(mailer.sent).toHaveLength(1);
    expect(await w.queued()).toEqual([]);
  });
});
