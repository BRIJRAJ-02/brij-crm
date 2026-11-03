// Spec 0067 steps 1 to 3 against a real Postgres as the app role: a visit counted for any page kind (AC-6701,
// AC-6702), its source read (AC-6703), the screen's numbers from rollups and raw rows alike (AC-6711 to AC-6714,
// AC-6730), sessions naming a person only through the access door (AC-6715), and numbers only share links that
// can be revoked and expire, each change audited (AC-6720).
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { FormDocument, FormQuestion } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { rescope, testScope } from '../testing.ts';
import { createForm, publishForm, saveFormDraft } from '../forms/forms.ts';
import { processSubmission } from '../forms/process.ts';
import { submitForm } from '../forms/public.ts';
import { countFormEvent } from '../forms/visits.ts';
import { readInsights, readInsightSessions } from './read.ts';
import { rollUpPageVisits } from './rollup.ts';
import { createInsightShare, listInsightShares, readInsightShare, revokeInsightShare } from './shares.ts';
import { countPageVisit, finishPageVisit, originOf } from './visits.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
const registry = jobKinds({ environment: 'local' });

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-insights-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Somewhere Nowhere',
    slug: `insights-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  return { scope, system, workspaceId: created.workspaceId, people: created.objects.people ?? '', query };
}
type Workspace = Awaited<ReturnType<typeof workspace>>;

const question = (
  changes: Partial<FormQuestion> & Pick<FormQuestion, 'id' | 'key' | 'label' | 'answerType'>,
): FormQuestion => ({ required: false, update: 'fill', ...changes });

async function liveForm(w: Workspace, name = 'Enquiry') {
  const created = await createForm(w.scope, { id: newId(), name });
  const document: FormDocument = {
    ...created.draft,
    questions: [
      ...created.draft.questions.filter((each) => each.key === 'name' || each.key === 'email'),
      question({ id: 'why', key: 'why', label: 'Why?', answerType: 'short_text' }),
    ],
  };
  const saved = await saveFormDraft(w.scope, { formId: created.id, document, expectedRevision: created.revision });
  return publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision });
}

/** A daily visitor hash, as the api mints one. */
const visitorHash = (seed: string) => createHash('sha256').update(seed).digest('hex').slice(0, 32);

/** A visit `daysAgo` back, written as the raw row the beacons leave. */
async function pastVisit(
  w: Workspace,
  formId: string,
  seed: string,
  daysAgo: number,
  extra: { source?: string; medium?: string; finished?: boolean; step?: string } = {},
) {
  await w.query(sql`
    insert into page_visits (workspace_id, page_kind, page_id, day, visitor, source, medium, furthest_step, step_rank,
      finished_at, duration_ms, first_at)
    values (${w.workspaceId}, 'form', ${formId}, (now() at time zone 'UTC')::date - ${daysAgo}::integer,
      ${visitorHash(seed)}, ${extra.source ?? 'direct'}, ${extra.medium ?? null}, ${extra.step ?? 'view'},
      ${extra.step === 'start' ? 1 : 0}, ${extra.finished === true ? sql`now()` : sql`null`},
      ${extra.finished === true ? 60_000 : null}, now() - make_interval(days => ${daysAgo}::integer))
  `);
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('It was let through.');
}

describe('where a visit came from (AC-6703)', () => {
  it('reads a UTM source with its medium and campaign, click ids as ads, and referrers by their group', () => {
    expect(
      originOf({ landing: { utm_source: 'Newsletter', utm_medium: 'email', utm_campaign: 'Nov Launch' } }).source,
    ).toEqual({ source: 'newsletter', medium: 'email', campaign: 'nov launch' });
    expect(originOf({ landing: { gclid: true } }).source).toEqual({ source: 'google', medium: 'paid' });
    expect(originOf({ landing: { fbclid: true } }).source).toEqual({ source: 'meta', medium: 'paid' });
    expect(originOf({ referrer: 'https://l.instagram.com/?u=x' }).source).toEqual({
      source: 'instagram',
      medium: 'referral',
    });
    expect(originOf({ referrer: 'https://www.google.co.uk/search?q=x' }).source.source).toBe('google');
    expect(originOf({ referrer: 'https://blog.example.com/a/b?c=1' }).source).toEqual({
      source: 'other',
      medium: 'referral',
      referrerHost: 'blog.example.com',
    });
    expect(originOf({ referrer: 'https://book.timefix.com/x', ownHosts: ['book.timefix.com'] }).source).toEqual({
      source: 'direct',
    });
    expect(originOf({}).source).toEqual({ source: 'direct' });
  });

  it('keeps a landing address’s UTM tags and a click id’s presence, never the id or anything else', () => {
    const origin = originOf({ landing: { utm_source: 'ig', gclid: true, secret: 'x' } });
    // An unknown key fails the strict shape, so nothing of that landing is kept at all.
    expect(origin.landing).toBeUndefined();
    expect(originOf({ landing: { utm_source: 'ig', gclid: true } }).landing).toEqual({ utm_source: 'ig', gclid: true });
  });
});

describe('the Insights numbers (AC-6711 to AC-6714, AC-6730)', () => {
  it('answers tiles against the period before, days, sources, Other’s hosts and the funnel', async () => {
    const w = await workspace();
    const form = await liveForm(w);
    const { scope, formId } = await enterPublicForm({ db }, form.publicKey);
    // Today: three visitors, from a newsletter, from Instagram and from a blog; two start; one finishes.
    await countFormEvent(scope, {
      formId,
      visitor: visitorHash('n'),
      kind: 'view',
      origin: originOf({ landing: { utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'nov' } }),
    });
    await countFormEvent(scope, {
      formId,
      visitor: visitorHash('i'),
      kind: 'view',
      origin: originOf({ referrer: 'https://instagram.com/x' }),
    });
    await countFormEvent(scope, {
      formId,
      visitor: visitorHash('b'),
      kind: 'view',
      origin: originOf({ referrer: 'https://blog.example.com/post' }),
    });
    await countFormEvent(scope, { formId, visitor: visitorHash('n'), kind: 'start' });
    await countFormEvent(scope, { formId, visitor: visitorHash('i'), kind: 'reach', questionId: 'why' });
    await submitForm(scope, registry, {
      formId,
      body: {
        idempotencyKey: newId(),
        answers: { name: 'Asha Rao', email: 'asha@example.com' },
        hidden: {},
        fillMs: 9_000,
      },
      captcha: { kind: 'off' },
      answersKey: 'a-test-key',
      visitor: visitorHash('n'),
    });
    // Ten days back, inside the period before a 7 day range: one visit.
    await pastVisit(w, form.id, 'old', 10);

    const read = await readInsights(w.scope, { period: { range: '7' }, pages: {} });
    expect(read.totals).toMatchObject({ visits: 3, finishes: 1 });
    expect(read.previous).toMatchObject({ visits: 1, finishes: 0 });
    expect(read.grain).toBe('day');
    expect(read.buckets).toHaveLength(7);
    expect(read.buckets.at(-1)).toMatchObject({ visits: 3, finishes: 1 });
    expect(read.sources).toEqual(
      expect.arrayContaining([
        { source: 'newsletter', medium: 'email', campaign: 'nov', visits: 1, finishes: 1 },
        { source: 'instagram', medium: 'referral', campaign: '', visits: 1, finishes: 0 },
        { source: 'other', medium: 'referral', campaign: '', visits: 1, finishes: 0 },
      ]),
    );
    expect(read.others).toEqual([{ host: 'blog.example.com', visits: 1 }]);
    // One kind of page, so a funnel: 3 saw it, 2 started (one went on to finish), 1 finished.
    expect(read.funnel).toEqual({
      kind: 'form',
      steps: [
        { step: 'view', reached: 3 },
        { step: 'start', reached: 2 },
      ],
      finished: 1,
    });
    expect(read.pages).toEqual([{ kind: 'form', id: form.id, name: 'Enquiry' }]);
    // A 90 day range is weekly.
    expect((await readInsights(w.scope, { period: { range: '90' }, pages: {} })).grain).toBe('week');
  });

  it('answers the same from rollups as from raw rows, and a day changed since is read raw again', async () => {
    const w = await workspace();
    const form = await liveForm(w);
    await pastVisit(w, form.id, 'a', 3, { source: 'newsletter', medium: 'email', finished: true, step: 'start' });
    await pastVisit(w, form.id, 'b', 3);
    await pastVisit(w, form.id, 'c', 40);
    const before = await readInsights(w.scope, { period: { range: '90' }, pages: {} });
    // The job takes every stale day, and none is left.
    expect((await rollUpPageVisits(w.system)).days).toBe(2);
    expect(await w.query(sql`select day from page_visit_stale_days`)).toEqual([]);
    expect((await w.query<{ n: number }>(sql`select count(*)::int as n from page_visit_days`))[0]?.n).toBeGreaterThan(
      0,
    );
    const after = await readInsights(w.scope, { period: { range: '90' }, pages: {} });
    expect(after.totals).toEqual(before.totals);
    expect(after.sources).toEqual(before.sources);
    expect(after.buckets).toEqual(before.buckets);
    expect(after.totals).toEqual({ visits: 3, finishes: 1, avgMs: 60_000 });
    // A late finish lands on a rolled up day: the day is stale again, and the read already counts it.
    await w.query(sql`update page_visits set finished_at = now() where visitor = ${visitorHash('b')}`);
    const late = await readInsights(w.scope, { period: { range: '90' }, pages: {} });
    expect(late.totals.finishes).toBe(2);
    // Only the system rolls up.
    await expect(rollUpPageVisits(w.scope)).rejects.toThrow();
  });

  it('shows nothing of a form whose object is hidden from the reader, and NOT_FOUND for that page by name', async () => {
    const w = await workspace();
    const form = await liveForm(w);
    await pastVisit(w, form.id, 'x', 1);
    const blind = rescope(w.scope, {
      role: 'admin',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'admin' }, target: { type: 'object', objectId: w.people }, level: 'none' },
        ],
        records: [],
      },
    });
    const read = await readInsights(blind, { period: { range: '30' }, pages: {} });
    expect(read.pages).toEqual([]);
    expect(read.totals.visits).toBe(0);
    expect(
      await refusalOf(readInsights(blind, { period: { range: '30' }, pages: { kind: 'form', pageId: form.id } })),
    ).toMatchObject([{ code: 'NOT_FOUND' }]);
  });

  it('refuses a custom range that runs backwards or past 400 days', async () => {
    const w = await workspace();
    await expect(
      readInsights(w.scope, { period: { from: '2026-10-10', to: '2026-10-01' }, pages: {} }),
    ).rejects.toThrow('Pick a start on or before the end.');
    await expect(
      readInsights(w.scope, { period: { from: '2025-01-01', to: '2026-10-01' }, pages: {} }),
    ).rejects.toThrow('Pick at most 400 days.');
  });
});

describe('a finish that may only end a counted visit (a link page’s press)', () => {
  it('finishes today’s counted visit, and makes nothing from nothing', async () => {
    const w = await workspace();
    const page = newId();
    await db.withWorkspace(w.workspaceId, async (tx) => {
      await finishPageVisit(tx, {
        workspaceId: w.workspaceId,
        kind: 'link',
        pageId: page,
        visitor: visitorHash('stranger'),
        onlyCounted: true,
      });
      await countPageVisit(tx, {
        workspaceId: w.workspaceId,
        kind: 'link',
        pageId: page,
        visitor: visitorHash('seen'),
        step: 'view',
      });
      await finishPageVisit(tx, {
        workspaceId: w.workspaceId,
        kind: 'link',
        pageId: page,
        visitor: visitorHash('seen'),
        onlyCounted: true,
      });
    });
    const rows = await w.query<{ visitor: string; finished: boolean }>(
      sql`select visitor, finished_at is not null as finished from page_visits`,
    );
    expect(rows).toEqual([{ visitor: visitorHash('seen'), finished: true }]);
  });
});

describe('sessions (AC-6715)', () => {
  it('names a finished visitor to a member who may read the submission, and nobody else', async () => {
    const w = await workspace();
    const form = await liveForm(w);
    const { scope, formId } = await enterPublicForm({ db }, form.publicKey);
    const visitor = visitorHash('asha');
    await countFormEvent(scope, {
      formId,
      visitor,
      kind: 'view',
      origin: originOf({ landing: { utm_source: 'ig', utm_campaign: 'nov', gclid: true } }),
    });
    await submitForm(scope, registry, {
      formId,
      body: {
        idempotencyKey: newId(),
        answers: { name: 'Asha Rao', email: 'asha@example.com' },
        hidden: {},
        fillMs: 9_000,
      },
      captcha: { kind: 'off' },
      answersKey: 'a-test-key',
      visitor,
    });
    const [submitted] = await w.query<{ id: string }>(sql`select id::text as id from form_submissions`);
    await runWrite(w.system, (context) => processSubmission(context, submitted?.id ?? ''));
    await countFormEvent(scope, { formId, visitor: visitorHash('looker'), kind: 'view' });

    const page = await readInsightSessions(w.scope, { period: { range: '7' }, pages: {}, filter: {} });
    expect(page.items).toHaveLength(2);
    const finished = page.items.find((item) => item.finished);
    expect(finished).toMatchObject({
      pageKind: 'form',
      pageName: 'Enquiry',
      source: 'ig',
      campaign: 'nov',
      furthestStep: 'finish',
      person: { name: 'Asha Rao', email: 'asha@example.com' },
      landing: { utm_source: 'ig', utm_campaign: 'nov', gclid: true },
    });
    // The other visitor never finished: no person, ever.
    expect(page.items.find((item) => !item.finished)?.person).toBeUndefined();
    // Filtered by a column.
    const onlyFinished = await readInsightSessions(w.scope, {
      period: { range: '7' },
      pages: {},
      filter: { finished: true },
    });
    expect(onlyFinished.items).toHaveLength(1);
    // A reader who can't see the form's object sees none of its sessions.
    const blind = rescope(w.scope, {
      role: 'admin',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'admin' }, target: { type: 'object', objectId: w.people }, level: 'none' },
        ],
        records: [],
      },
    });
    expect((await readInsightSessions(blind, { period: { range: '7' }, pages: {}, filter: {} })).items).toEqual([]);
  });

  it('pages by cursor, newest first, and refuses a cursor it never gave', async () => {
    const w = await workspace();
    const form = await liveForm(w);
    for (let at = 0; at < 55; at += 1) await pastVisit(w, form.id, `p${String(at)}`, 0);
    const first = await readInsightSessions(w.scope, { period: { range: '7' }, pages: {}, filter: {} });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeDefined();
    const second = await readInsightSessions(w.scope, {
      period: { range: '7' },
      pages: {},
      filter: {},
      ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
    });
    expect(second.items).toHaveLength(5);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(55);
    await expect(
      readInsightSessions(w.scope, { period: { range: '7' }, pages: {}, filter: {}, cursor: 'bm9wZQ' }),
    ).rejects.toThrow();
  });
});

describe('share links (AC-6720)', () => {
  it('opens numbers only, never a host, a session or a name; revoked or expired, opens nothing; both audited', async () => {
    const w = await workspace();
    const form = await liveForm(w);
    await pastVisit(w, form.id, 'one', 1, { source: 'other' });
    await w.query(sql`update page_visits set referrer_host = 'secret-partner.example.com'`);
    const made = await createInsightShare(w.scope, { label: 'For the client', pages: {}, range: '30' });
    expect(made.token).toMatch(/^[0-9a-f]{64}[A-Za-z0-9_-]{43}$/);
    expect(made.share).toMatchObject({ label: 'For the client', range: '30', pageCount: 1, isMine: true });
    // Only the secret's hash is stored.
    const stored = await w.query<{ token_hash: string }>(sql`select token_hash from insight_shares`);
    expect(stored[0]?.token_hash).not.toContain(made.token.slice(64));

    const shared = await readInsightShare({ db }, made.token);
    expect(shared.label).toBe('For the client');
    expect(shared.pageNames).toEqual(['Enquiry']);
    expect(shared.numbers.totals.visits).toBe(1);
    const text = JSON.stringify(shared);
    expect(text).not.toContain('secret-partner');
    expect(text).not.toContain('others');
    expect(text).not.toContain(visitorHash('one'));

    // A wrong secret, and another workspace's id with the right secret, open nothing.
    const wrong = `${made.token.slice(0, 64)}${'A'.repeat(43)}`;
    expect(await refusalOf(readInsightShare({ db }, wrong))).toMatchObject([{ code: 'NOT_FOUND' }]);
    const elsewhere = `${'0'.repeat(32)}${made.token.slice(32)}`;
    expect(await refusalOf(readInsightShare({ db }, elsewhere))).toMatchObject([{ code: 'NOT_FOUND' }]);

    // Expired.
    const dated = await createInsightShare(w.scope, {
      label: 'A week',
      pages: {},
      range: '7',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(await refusalOf(readInsightShare({ db }, dated.token, new Date(Date.now() + 2 * 86_400_000)))).toMatchObject(
      [{ code: 'NOT_FOUND' }],
    );

    // Revoked.
    const revoked = await revokeInsightShare(w.scope, { shareId: made.share.id });
    expect(revoked.revokedAt).toBeDefined();
    expect(await refusalOf(readInsightShare({ db }, made.token))).toMatchObject([{ code: 'NOT_FOUND' }]);
    expect((await listInsightShares(w.scope)).shares).toHaveLength(2);

    const audit = await w.query<{ action: string }>(
      sql`select action from audit_events where action like 'insights.%' order by at, action`,
    );
    expect(audit.map((row) => row.action).sort()).toEqual([
      'insights.share_created',
      'insights.share_created',
      'insights.share_revoked',
    ]);
  });

  it('stops opening once its maker is no longer an active member, and hides deleted pages’ names', async () => {
    const w = await workspace();
    const form = await liveForm(w);
    await pastVisit(w, form.id, 'one', 1);
    const made = await createInsightShare(w.scope, { label: 'Client', pages: {}, range: '30' });
    expect((await readInsightShare({ db }, made.token)).pageNames).toEqual(['Enquiry']);
    await w.query(sql`update forms set status = 'archived', archived_at = now() where id = ${form.id}`);
    expect((await readInsightShare({ db }, made.token)).pageNames).toEqual([]);
    // Another owner first: the last one can't go.
    await w.query(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${w.workspaceId}, ${newId()}, 'Grace', 'grace@example.com', 'owner', 'system', 'system')`,
    );
    await w.query(sql`update members set status = 'removed' where email = 'ada@example.com'`);
    expect(await refusalOf(readInsightShare({ db }, made.token))).toMatchObject([{ code: 'NOT_FOUND' }]);
  });

  it('refuses an expiry in the past, and a page the maker can’t see', async () => {
    const w = await workspace();
    const form = await liveForm(w);
    await expect(
      createInsightShare(w.scope, {
        label: 'Old',
        pages: {},
        range: '7',
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).rejects.toThrow();
    const blind = rescope(w.scope, {
      role: 'admin',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'admin' }, target: { type: 'object', objectId: w.people }, level: 'none' },
        ],
        records: [],
      },
    });
    expect(
      await refusalOf(
        createInsightShare(blind, { label: 'Leak', pages: { kind: 'form', pageId: form.id }, range: '7' }),
      ),
    ).toMatchObject([{ code: 'NOT_FOUND' }]);
  });
});
