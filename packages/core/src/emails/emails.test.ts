// Queued email (the emails lane), against a real Postgres as the app role:
// queueing in the caller's transaction (once per key, a rolled back change
// queues nothing, params its template doesn't know refused without throwing,
// a batch answered in order), reading one back for the worker (a member
// reader's address, a removed member, a topic turned off, too old to send),
// recording how sending went (blanked once finished), and the preferences
// link: its signed token and the narrow scope it opens, which no member
// service takes.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { enterEmailLink, systemScope } from '../access/door.ts';
import { inWorkspace } from '../access/run.ts';
import { listCalendarConnections } from '../calendar/connections.ts';
import { newId } from '../engine/ids.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import {
  EMAIL_LINK_DAYS,
  emailLinkToken,
  readEmailLinkToken,
  readEmailPreferences,
  setEmailPreference,
} from './preferences.ts';
import {
  emailKey,
  queueEmail,
  queueEmails,
  queueFormConfirmation,
  queueFormSubmissionNotice,
  queueImportFinished,
  type QueuedEmail,
} from './queue.ts';
import { finishEmail, loadEmail } from './send.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-emails-tests' });
});
afterAll(async () => {
  await db.close();
});

const KEY = Buffer.alloc(32, 7);

/** The id of an email the test queued: refused is a failure here. */
function idOf(queued: QueuedEmail): string {
  if (queued.outcome === 'refused') throw new Error(`The test's email was refused: ${queued.code}.`);
  return queued.emailId;
}

/** A workspace with its owner, and a second member. */
async function workspace() {
  const created = await createWorkspace(db, {
    name: 'Mail',
    slug: `mail-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const bea = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(sql`
      insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
      values (${created.workspaceId}, ${bea}, 'Bea', 'bea@example.com', 'member', 'system', 'system')
    `),
  );
  const system = systemScope(db, created.workspaceId);
  const rows = () =>
    db.withWorkspace(created.workspaceId, async (tx) => {
      const found = await tx.execute<{
        id: string;
        kind: string;
        key: string;
        status: string;
        params: unknown;
        to_address: string | null;
        attempts: number;
        error_code: string | null;
        sent: boolean;
      }>(sql`
        select id::text, kind, key, status, params, to_address, attempts, error_code, sent_at is not null as sent
        from emails order by created_at, id
      `);
      return found.rows;
    });
  return { ...created, bea, system, rows };
}

const IMPORT = {
  objectName: 'People',
  outcome: 'done',
  created: 3,
  updated: 0,
  skipped: 0,
  failed: 0,
  resultPath: '/w/mail/objects/people',
} as const;

describe('queueing an email', () => {
  it('stores it once per key in the caller’s transaction, and answers the same email again', async () => {
    const w = await workspace();
    const importId = newId();
    const first = await inWorkspace(w.system, (tx) =>
      queueImportFinished(tx, { importId, memberId: w.bea, params: IMPORT }),
    );
    const again = await inWorkspace(w.system, (tx) =>
      queueImportFinished(tx, { importId, memberId: w.bea, params: IMPORT }),
    );
    expect(first.outcome).toBe('queued');
    expect(again).toEqual({ outcome: 'exists', emailId: idOf(first) });
    expect(await w.rows()).toMatchObject([
      {
        id: idOf(first),
        kind: 'import_finished',
        key: `import_finished:${importId}`,
        status: 'queued',
        params: IMPORT,
      },
    ]);
  });

  it('queues nothing when the change it belongs to rolls back', async () => {
    const w = await workspace();
    await expect(
      inWorkspace(w.system, async (tx) => {
        await queueImportFinished(tx, { importId: newId(), memberId: w.bea, params: IMPORT });
        throw new Error('The change was refused.');
      }),
    ).rejects.toThrow('The change was refused.');
    expect(await w.rows()).toEqual([]);
  });

  it('refuses params its template doesn’t know (a link off the app) without throwing, and an address in the key', async () => {
    const w = await workspace();
    const offApp = await inWorkspace(w.system, (tx) =>
      queueImportFinished(tx, {
        importId: newId(),
        memberId: w.bea,
        params: { ...IMPORT, resultPath: '//evil.example' },
      }),
    );
    expect(offApp).toEqual({ outcome: 'refused', code: 'PARAMS_INVALID' });
    const badAddress = await inWorkspace(w.system, (tx) =>
      queueFormConfirmation(tx, {
        submissionId: newId(),
        address: 'Asha <asha@northwind.example>',
        params: { formName: 'Contact us', answers: [], submittedAt: '2026-10-21T13:05:00.000Z' },
      }),
    );
    expect(badAddress).toEqual({ outcome: 'refused', code: 'PARAMS_INVALID' });
    // A key is ids only: a value in it is a bug, thrown.
    await expect(
      inWorkspace(w.system, (tx) =>
        queueEmail(tx, { kind: 'import_finished', ids: ['ada@example.com'], to: { memberId: w.bea }, params: IMPORT }),
      ),
    ).rejects.toThrow();
    expect(() => emailKey('import_finished', [])).toThrow();
    expect(await w.rows()).toEqual([]);
  });

  it('queues a batch at once, answering each in order: queued, already queued, refused', async () => {
    const w = await workspace();
    const before = newId();
    const earlier = await inWorkspace(w.system, (tx) =>
      queueImportFinished(tx, { importId: before, memberId: w.bea, params: IMPORT }),
    );
    const fresh = newId();
    const answers = await inWorkspace(w.system, (tx) =>
      queueEmails(tx, [
        { kind: 'import_finished', ids: [fresh], to: { memberId: w.bea }, params: IMPORT },
        { kind: 'import_finished', ids: [before], to: { memberId: w.bea }, params: IMPORT },
        { kind: 'import_finished', ids: [newId()], to: { memberId: w.bea }, params: { ...IMPORT, resultPath: 'x' } },
      ]),
    );
    expect(answers).toEqual([
      { outcome: 'queued', emailId: expect.any(String) as string },
      { outcome: 'exists', emailId: idOf(earlier) },
      { outcome: 'refused', code: 'PARAMS_INVALID' },
    ]);
    expect((await w.rows()).map((row) => row.key)).toEqual([`import_finished:${before}`, `import_finished:${fresh}`]);
  });
});

describe('sending a queued email (the worker’s half)', () => {
  const NOTICE = {
    formName: 'Contact us',
    submitter: { name: 'Asha', email: 'asha@northwind.example' },
    answers: [{ label: 'Company', value: 'Northwind' }],
    submittedAt: '2026-10-21T13:05:00.000Z',
    submissionPath: '/w/mail/captures/forms/x',
  };

  it('reads a member reader’s address and the workspace, then blanks what it said once sent', async () => {
    const w = await workspace();
    const emailId = idOf(
      await inWorkspace(w.system, (tx) =>
        queueFormSubmissionNotice(tx, { submissionId: newId(), memberId: w.memberId, params: NOTICE }),
      ),
    );
    const loaded = await loadEmail(w.system, emailId);
    expect(loaded).toMatchObject({
      kind: 'send',
      email: {
        id: emailId,
        kind: 'form_submission',
        to: 'ada@example.com',
        memberId: w.memberId,
        topic: 'form_submissions',
        workspaceName: 'Mail',
        params: NOTICE,
      },
    });
    await finishEmail(w.system, emailId, { status: 'sent' });
    expect(await w.rows()).toMatchObject([{ status: 'sent', params: {}, sent: true, attempts: 1 }]);
    // Sent once: a second try finds it done.
    expect(await loadEmail(w.system, emailId)).toEqual({ kind: 'done' });
  });

  it('sends a visitor’s confirmation to their address, with replies to the form’s owner', async () => {
    const w = await workspace();
    const emailId = idOf(
      await inWorkspace(w.system, (tx) =>
        queueFormConfirmation(tx, {
          submissionId: newId(),
          address: 'asha@northwind.example',
          replyToMemberId: w.memberId,
          params: { formName: 'Contact us', answers: [], submittedAt: '2026-10-21T13:05:00.000Z' },
        }),
      ),
    );
    const loaded = await loadEmail(w.system, emailId);
    expect(loaded).toMatchObject({ kind: 'send', email: { to: 'asha@northwind.example', replyTo: 'ada@example.com' } });
    expect(loaded.kind === 'send' ? loaded.email.topic : 'none').toBeUndefined();
    await finishEmail(w.system, emailId, { status: 'sent' });
    expect(await w.rows()).toMatchObject([{ status: 'sent', to_address: null, params: {} }]);
  });

  it('skips a removed member, a topic turned off and an email too old to send, and counts a failed try', async () => {
    const w = await workspace();
    const queue = async (memberId: string) =>
      idOf(
        await inWorkspace(w.system, (tx) =>
          queueFormSubmissionNotice(tx, { submissionId: newId(), memberId, params: NOTICE }),
        ),
      );
    const removed = await queue(w.bea);
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update members set status = 'removed' where id = ${w.bea}::uuid`),
    );
    expect(await loadEmail(w.system, removed)).toEqual({ kind: 'skip', reason: 'recipient_gone' });

    const off = await queue(w.memberId);
    const owner = await enterEmailLink(
      { db },
      { workspaceId: w.workspaceId, memberId: w.memberId, topic: 'form_submissions' },
    );
    await setEmailPreference(owner, { topic: 'form_submissions', subscribed: false }, 'form_submissions');
    expect(await loadEmail(w.system, off)).toEqual({ kind: 'skip', reason: 'opted_out' });
    const [choice] = (
      await db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute<{ updated_via: string }>(sql`select updated_via from email_preferences`),
      )
    ).rows;
    expect(choice).toEqual({ updated_via: 'email_link' });

    await finishEmail(w.system, off, { status: 'retry', code: 'send_failed' });
    await finishEmail(w.system, off, { status: 'failed', code: 'send_failed' });
    const [, failed] = await w.rows();
    expect(failed).toMatchObject({ status: 'failed', attempts: 2, error_code: 'send_failed', params: {} });

    await setEmailPreference(owner, { topic: 'form_submissions', subscribed: true }, 'form_submissions');
    const old = await queue(w.memberId);
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update emails set created_at = now() - interval '25 hours' where id = ${old}::uuid`),
    );
    expect(await loadEmail(w.system, old)).toEqual({ kind: 'skip', reason: 'stale' });
  });
});

describe('the preferences link', () => {
  const link = (workspaceId: string, memberId: string) => ({ workspaceId, memberId, topic: 'mentions' as const });

  it('reads back what it signed, and nothing tampered with, expired or signed with another key', () => {
    const at = new Date('2026-10-21T00:00:00.000Z');
    const made = { workspaceId: newId(), memberId: newId(), topic: 'mentions' as const };
    const token = emailLinkToken(KEY, made, at);
    expect(emailLinkToken(KEY, made, at)).toBe(token);
    expect(readEmailLinkToken(KEY, token, at)).toEqual(made);
    expect(readEmailLinkToken(Buffer.alloc(32, 8), token, at)).toBeUndefined();
    expect(readEmailLinkToken(KEY, `${token}x`, at)).toBeUndefined();
    expect(readEmailLinkToken(KEY, token, new Date(at.getTime() + (EMAIL_LINK_DAYS + 1) * 86_400_000))).toBeUndefined();
    expect(readEmailLinkToken(KEY, undefined, at)).toBeUndefined();
    // Each use has its own: the one click's token never opens the page, nor the page's the one click.
    const oneClick = emailLinkToken(KEY, made, at, 'unsubscribe');
    expect(readEmailLinkToken(KEY, oneClick, at, 'unsubscribe')).toEqual(made);
    expect(readEmailLinkToken(KEY, oneClick, at, 'page')).toBeUndefined();
    expect(readEmailLinkToken(KEY, token, at, 'unsubscribe')).toBeUndefined();
    // Ids and a topic only: no address rides in it.
    expect(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()).not.toContain('@');
  });

  it('opens its member’s own choices, every topic on until turned off, with no permission to anything else', async () => {
    const w = await workspace();
    const scope = await enterEmailLink({ db }, link(w.workspaceId, w.bea));
    expect(scope.actor).toEqual({ type: 'member', id: w.bea });
    expect(scope.access.principal).toEqual({ kind: 'email_link', memberId: w.bea });
    expect(scope.access.permissions).toEqual([]);
    // Not a member principal: a member's own service (their calendars) refuses it.
    await expect(listCalendarConnections(scope)).rejects.toMatchObject({ refusals: [{ code: 'FORBIDDEN' }] });
    expect(await readEmailPreferences(scope, 'mentions')).toEqual({
      workspaceName: 'Mail',
      topic: 'mentions',
      preferences: [
        { topic: 'form_submissions', subscribed: true },
        { topic: 'mentions', subscribed: true },
      ],
    });
    const changed = await setEmailPreference(scope, { topic: 'form_submissions', subscribed: false }, 'mentions');
    expect(changed.preferences).toEqual([
      { topic: 'form_submissions', subscribed: false },
      { topic: 'mentions', subscribed: true },
    ]);
    // Another member's choices are theirs alone.
    const ada = await enterEmailLink({ db }, link(w.workspaceId, w.memberId));
    expect((await readEmailPreferences(ada, 'mentions')).preferences.every((each) => each.subscribed)).toBe(true);
  });

  it('opens nothing for a removed member or another workspace’s', async () => {
    const w = await workspace();
    const other = await workspace();
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update members set status = 'removed' where id = ${w.bea}::uuid`),
    );
    const gone = [{ code: 'NOT_FOUND', message: 'This link doesn’t open email preferences any more.' }];
    await expect(enterEmailLink({ db }, link(w.workspaceId, w.bea))).rejects.toMatchObject({ refusals: gone });
    await expect(enterEmailLink({ db }, link(other.workspaceId, w.memberId))).rejects.toMatchObject({
      refusals: gone,
    });
  });
});
