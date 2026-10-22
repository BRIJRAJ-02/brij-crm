// One mention, one email (spec 0038, AC-1176): a mention reaches the member
// once, in the notifications email (`crm_notification_email`, queued by
// `crm_enqueue_notification_email`), and the workspace email queue holds
// nothing for it (the queue has no mention kind). Each case counts the waiting
// Graphile job and the emails sent: a comment, a reply that mentions a thread
// writer, a note save that keeps the mention, and an edit that names the same
// member again. A member with mention emails off, in their settings or from an
// email's preferences link, gets none. Against the test database, with a fake
// mailer; the task is run as the worker would, then its job removed as the
// worker does when it completes.
import { mentionToken } from '@crm/contracts';
import {
  createComment,
  createRecord,
  createWorkspace,
  newId,
  NO_RULE_SOURCE,
  saveNote,
  setNotificationSettings,
  updateComment,
} from '@crm/core';
import { enterEmailLink, setEmailPreference } from '@crm/core/public';
import { testScope } from '@crm/core/testing';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Mailer, MailMessage } from '../mail/mailer.ts';
import { runNotificationEmail } from './notification-email.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
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

/** A note's document that mentions each of `members`, after `text`. */
const noteDoc = (text: string, ...members: readonly string[]) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text }, ...members.map((id) => ({ type: 'mention', attrs: { id, label: 'Bea' } }))],
    },
  ],
});

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
  const asBea = testScope({ db, workspaceId, actor: { type: 'member', id: bea } });
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
  const jobKey = `crm-notify:${workspaceId}:${bea}`;
  /** Bea's waiting notifications email jobs: one key, so never more than one. */
  const jobs = async () =>
    (
      await testQuery<{ task: string }>(
        ownerUrl,
        `select task_identifier as task from graphile_worker.jobs where key = $1`,
        [jobKey],
      )
    ).map((row) => row.task);
  const send = async (mailer: Mailer) =>
    runNotificationEmail(
      { door: { db, rules: NO_RULE_SOURCE }, mailer, appOrigin: 'https://app.example.com', log: quiet },
      { workspaceId, memberId: bea },
    );
  /** Runs Bea's email as the worker would, then takes its job off the queue as a completed job is. */
  const work = async (mailer: Mailer) => {
    await send(mailer);
    await testQuery(ownerUrl, `select graphile_worker.remove_job($1)`, [jobKey]);
  };
  return { workspaceId, ada, asBea, bea, recordId, mention, queued, jobs, send, work };
}

describe('a mention’s email', () => {
  it('is one email, the notifications email, however often the task runs, and none with the topic off', async () => {
    const w = await world();
    await w.mention();
    expect(await w.jobs()).toEqual(['crm_notification_email']);
    const mailer = fakeMailer();
    await w.send(mailer);
    await w.work(mailer);
    expect(mailer.sent.map((message) => message.to)).toEqual(['bea@example.com']);
    expect(mailer.sent[0]?.text).toContain('Ada mentioned you');
    // Nothing went the other way: the workspace email queue holds no email for the mention.
    expect(await w.queued()).toEqual([]);

    // Mentions turned off from an email's preferences link: the next mention is never emailed.
    const link = await enterEmailLink({ db }, { workspaceId: w.workspaceId, memberId: w.bea, topic: 'mentions' });
    await setEmailPreference(link, { topic: 'mentions', subscribed: false }, 'mentions');
    await w.mention();
    // Not even queued: the email would hold nothing for her.
    expect(await w.jobs()).toEqual([]);
    await w.send(mailer);
    expect(mailer.sent).toHaveLength(1);
    expect(await w.queued()).toEqual([]);
  });

  it('in a comment that names the member twice is one job, one email and one line in it', async () => {
    const w = await world();
    await createComment(w.ada, {
      id: newId(),
      recordId: w.recordId,
      body: `${mentionToken(w.bea)} can you call them? ${mentionToken(w.bea)} and send the deck.`,
    });
    expect(await w.jobs()).toEqual(['crm_notification_email']);
    const mailer = fakeMailer();
    await w.work(mailer);
    await w.send(mailer);
    expect(mailer.sent.map((message) => message.to)).toEqual(['bea@example.com']);
    expect(mailer.sent[0]?.text.match(/Ada mentioned you/g)).toHaveLength(1);
    expect(mailer.sent[0]?.text).not.toContain('replied in a thread');
    expect(await w.queued()).toEqual([]);
  });

  it('in a reply that mentions a writer of the thread is one email, the mention, never a reply too', async () => {
    const w = await world();
    // Bea gets reply emails as well, so a reply notification beside the mention would show in the email.
    await setNotificationSettings(w.asBea, { emailReplies: true });
    const thread = await createComment(w.asBea, { id: newId(), recordId: w.recordId, body: 'Who has the deck?' });
    expect(await w.jobs()).toEqual([]);
    await createComment(w.ada, {
      id: newId(),
      recordId: w.recordId,
      threadId: thread.id,
      body: `I do, ${mentionToken(w.bea)}. Sending it now, ${mentionToken(w.bea)}.`,
    });
    expect(await w.jobs()).toEqual(['crm_notification_email']);
    const mailer = fakeMailer();
    await w.work(mailer);
    await w.send(mailer);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text.match(/Ada mentioned you/g)).toHaveLength(1);
    expect(mailer.sent[0]?.text).not.toContain('replied in a thread');
    expect(await w.queued()).toEqual([]);
  });

  it('in a note is one email, and a later save that keeps the mention sends nothing more', async () => {
    const w = await world();
    const noteId = newId();
    await saveNote(w.ada, { id: noteId, recordId: w.recordId, title: 'Renewal', content: noteDoc('Over to ', w.bea) });
    expect(await w.jobs()).toEqual(['crm_notification_email']);
    const mailer = fakeMailer();
    await w.work(mailer);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text).toContain('Ada mentioned you in a note');

    // New words around the same mention: nothing queued, nothing sent.
    await saveNote(w.ada, {
      id: noteId,
      recordId: w.recordId,
      content: noteDoc('Over to you on the renewal, ', w.bea),
      baseVersion: 1,
    });
    // And the same member named twice in one save.
    await saveNote(w.ada, {
      id: noteId,
      recordId: w.recordId,
      content: noteDoc('Over to ', w.bea, w.bea),
      baseVersion: 2,
    });
    expect(await w.jobs()).toEqual([]);
    await w.send(mailer);
    expect(mailer.sent).toHaveLength(1);
    expect(await w.queued()).toEqual([]);
  });

  it('in a comment edit that names the same member again sends nothing more', async () => {
    const w = await world();
    const thread = await w.mention();
    const commentId = thread.comments[0]?.id ?? '';
    const mailer = fakeMailer();
    await w.work(mailer);
    expect(mailer.sent).toHaveLength(1);

    await updateComment(w.ada, {
      commentId,
      body: `Can you take the demo, ${mentionToken(w.bea)}? Thanks ${mentionToken(w.bea)}.`,
    });
    expect(await w.jobs()).toEqual([]);
    await w.send(mailer);
    expect(mailer.sent).toHaveLength(1);
    expect(await w.queued()).toEqual([]);
  });

  it('in a comment edit that drops the member and names them again before the email goes is still one email', async () => {
    const w = await world();
    const thread = await w.mention();
    const commentId = thread.comments[0]?.id ?? '';
    await updateComment(w.ada, { commentId, body: 'Can you take the demo?' });
    await updateComment(w.ada, { commentId, body: `Can you take the demo after all, ${mentionToken(w.bea)}?` });
    // One waiting job (keyed per member), so the burst is one email with one line.
    expect(await w.jobs()).toEqual(['crm_notification_email']);
    const mailer = fakeMailer();
    await w.work(mailer);
    await w.send(mailer);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text.match(/Ada mentioned you/g)).toHaveLength(1);
  });

  it('is never sent to a member who turned mention emails off in their settings', async () => {
    const w = await world();
    await setNotificationSettings(w.asBea, { emailMentions: false });
    await w.mention();
    await saveNote(w.ada, { id: newId(), recordId: w.recordId, title: 'Plan', content: noteDoc('Over to ', w.bea) });
    // Nothing queued for her at all, and a task run anyway (another kind's email, say) holds no mention. The daily
    // digest is its own opt in and carries every kind still unread (AC-1178), so it is not this switch's to stop.
    expect(await w.jobs()).toEqual([]);
    const mailer = fakeMailer();
    await w.send(mailer);
    expect(mailer.sent).toEqual([]);
    expect(await w.queued()).toEqual([]);
  });
});
