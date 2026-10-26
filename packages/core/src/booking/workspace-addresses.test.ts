// A link page, a form's redirect and a routing rule's redirect never send a visitor to another workspace's page
// (spec 0056, AC-5610 to AC-5613), against the real Postgres. One person holds two workspaces, each with its own
// handle, booking page and form; every address that names the other's must be refused, a missing one the same
// way, an address on any other site left alone, and `/b/:key` and `/f/:key` themselves unchanged.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { FormDocument, RoutingRule, SubmitBody } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage, enterLinkPage, enterPublicForm } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createForm, publishForm, saveFormDraft } from '../forms/forms.ts';
import { submitForm } from '../forms/public.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { updateMyMemberProfile } from '../members/profile.ts';
import { archiveProfileItem, importProfileLinks, readProfileItems, saveProfileItem } from '../profile/items.ts';
import { testScope } from '../testing.ts';
import { createBookingPage } from './pages.ts';
import { readLinkPage } from './public.ts';
import { workspaceAddressProblem } from './workspace-addresses.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

const ORIGIN = 'https://timefix.test';
const origins = [ORIGIN];
const REFUSAL = 'That page isn’t in this workspace.';

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-workspace-address-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

async function inWorkspace(name: string, userId: string) {
  count += 1;
  await testQuery(
    ownerUrl,
    `insert into auth."user" (id, name, email) values ($1, $2, $3) on conflict (id) do nothing`,
    [userId, 'Ada', `${userId}@example.com`],
  );
  const created = await createWorkspace(db, {
    name,
    slug: `addr-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  const handle = `ada-${randomUUID().slice(0, 8)}`;
  await updateMyMemberProfile(scope, { handle });
  const booking = await createBookingPage(scope, {
    id: newId(),
    title: `${name} intro`,
    timeZone: 'Europe/London',
    settings: {},
  });
  const form = await createForm(scope, { id: newId(), name: `${name} form` });
  return { ...created, scope, handle, booking, form };
}

async function refusalOf(promise: Promise<unknown>): Promise<{ code: string; message: string } | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return { code: error.refusal.code, message: error.refusal.message };
    throw error;
  }
}

async function setup() {
  const userId = randomUUID();
  const acme = await inWorkspace('Acme', userId);
  const home = await inWorkspace('Personal', userId);
  return { acme, home };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Every address that names the other workspace's page, in each shape the spec lists. */
const foreign = (other: Setup['home']) => [
  `${ORIGIN}/b/${other.booking.publicKey}`,
  `${ORIGIN}/f/${other.form.publicKey}`,
  `${ORIGIN}/${other.handle}`,
  `${ORIGIN}/${other.handle}/${other.booking.slug}`,
];

/** And the ones that name its own workspace's, or nothing of ours at all, which are let through. */
const allowed = (own: Setup['acme']) => [
  `${ORIGIN}/b/${own.booking.publicKey}`,
  `${ORIGIN}/f/${own.form.publicKey}`,
  `${ORIGIN}/${own.handle}`,
  `${ORIGIN}/${own.handle}/${own.booking.slug}`,
  'https://example.com/b/anything',
  `${ORIGIN}/sign-in`,
];

describe('workspaceAddressProblem', () => {
  it('refuses another workspace’s page, form and handle, and a missing one, the same way', async () => {
    const { acme, home } = await setup();
    const problem = (url: string) =>
      db.withWorkspace(acme.workspaceId, (tx) => workspaceAddressProblem(tx, acme.workspaceId, url, origins));
    for (const url of foreign(home)) expect(await problem(url), url).toBe(REFUSAL);
    for (const url of [`${ORIGIN}/b/nosuchpage12345`, `${ORIGIN}/f/no-such-form`, `${ORIGIN}/nobody-here`]) {
      expect(await problem(url), url).toBe(REFUSAL);
    }
    for (const url of allowed(acme)) expect(await problem(url), url).toBeUndefined();
    // No origin known means nothing is one of ours: the callers always pass the deployment's.
    expect(
      await db.withWorkspace(acme.workspaceId, (tx) =>
        workspaceAddressProblem(tx, acme.workspaceId, foreign(home)[0] ?? '', []),
      ),
    ).toBeUndefined();
  });
});

describe('a link on a link page', () => {
  it('refuses another workspace’s address and keeps the rest', async () => {
    const { acme, home } = await setup();
    const link = (url: string) =>
      saveProfileItem(
        acme.scope,
        { id: newId(), block: { kind: 'link', title: 'Go', url } },
        { publicOrigins: origins },
      );
    for (const url of foreign(home)) {
      expect(await refusalOf(link(url)), url).toEqual({ code: 'CONFIG_INVALID', message: REFUSAL });
    }
    for (const url of allowed(acme)) expect(await link(url), url).toMatchObject({ kind: 'link' });
  });

  it('skips on read a link that has come to name another workspace’s page, and a stray page row', async () => {
    const { acme, home } = await setup();
    const seen = async () =>
      (await readLinkPage(await enterLinkPage({ db }, acme.handle, { max: 21, publicOrigins: origins }))).items.map(
        (item) => (item.kind === 'link' ? item.title : item.kind),
      );
    const stays = await saveProfileItem(
      acme.scope,
      { id: newId(), block: { kind: 'link', title: 'Own', url: `${ORIGIN}/${acme.handle}/${acme.booking.slug}` } },
      { publicOrigins: origins },
    );
    expect(await seen()).toContain('Own');
    // A link written past the service (a slug reused, a page moved) to the other workspace's page is not followed.
    await testQuery(
      ownerUrl,
      `insert into auth.profile_items (id, user_id, workspace_id, kind, position, data) values ($1, $2, $3, 'link', 40, $4)`,
      [
        newId(),
        acme.scope.access.principal.kind === 'member' ? (acme.scope.access.principal.userId ?? '') : '',
        acme.workspaceId,
        JSON.stringify({ title: 'Sneaky', url: foreign(home)[0] }),
      ],
    );
    const names = await seen();
    expect(names).toContain('Own');
    expect(names).not.toContain('Sneaky');
    expect(stays.id).toBeDefined();
    // The editor marks it, in the same words as nothing else, and leaves the link to its own page unmarked.
    const marked = (await readProfileItems(acme.scope, { publicOrigins: origins })).items.flatMap((item) =>
      item.kind === 'link' ? [[item.title, item.outsideWorkspace === true] as const] : [],
    );
    expect(marked).toEqual(
      expect.arrayContaining([
        ['Own', false],
        ['Sneaky', true],
      ]),
    );
  });
});

describe('the other ways a link reaches a page (security review)', () => {
  it('keeps an imported row naming another workspace’s page behind, and never restores one to the page', async () => {
    const { acme, home } = await setup();
    const [foreignUrl = ''] = foreign(home);
    const imported = await importProfileLinks(
      acme.scope,
      {
        id: newId(),
        source: 'https://linktr.ee/ada',
        rows: [
          { title: 'Theirs', url: foreignUrl },
          { title: 'Mine', url: 'https://ada.dev' },
        ],
        skipped: [],
      },
      { publicOrigins: origins },
    );
    expect(imported.import.made).toBe(1);
    expect(imported.import.skipped).toEqual([{ title: 'Theirs', url: foreignUrl, reason: 'not-in-workspace' }]);
    // A link that came to name another workspace's page while archived stays archived.
    const held = await saveProfileItem(
      acme.scope,
      { id: newId(), block: { kind: 'link', title: 'Later', url: 'https://ada.dev/later' } },
      { publicOrigins: origins },
    );
    await archiveProfileItem(acme.scope, { id: held.id, archived: true }, { publicOrigins: origins });
    await testQuery(ownerUrl, `update auth.profile_items set data = $2 where id = $1`, [
      held.id,
      JSON.stringify({ title: 'Later', url: foreignUrl, hue: 'blue' }),
    ]);
    expect(
      await refusalOf(archiveProfileItem(acme.scope, { id: held.id, archived: false }, { publicOrigins: origins })),
    ).toEqual({ code: 'CONFIG_INVALID', message: REFUSAL });
  });

  it('never cuts the public page short when a block among the first page is skipped', async () => {
    const { acme, home } = await setup();
    const userId = acme.scope.access.principal.kind === 'member' ? (acme.scope.access.principal.userId ?? '') : '';
    // Clear the page, then 25 links with one stray among the first twenty.
    await testQuery(ownerUrl, `delete from auth.profile_items where user_id = $1 and workspace_id = $2`, [
      userId,
      acme.workspaceId,
    ]);
    for (let n = 0; n < 25; n += 1) {
      const url = n === 3 ? (foreign(home)[0] ?? '') : `https://ada.dev/${String(n)}`;
      await testQuery(
        ownerUrl,
        `insert into auth.profile_items (id, user_id, workspace_id, kind, position, data) values ($1, $2, $3, 'link', $4, $5)`,
        [newId(), userId, acme.workspaceId, n, JSON.stringify({ title: `Link ${String(n)}`, url, hue: 'blue' })],
      );
    }
    const first = await readLinkPage(await enterLinkPage({ db }, acme.handle, { max: 21, publicOrigins: origins }));
    expect(first.items).toHaveLength(19);
    expect(first.next).toBeDefined();
    const [position, id] = (first.next ?? '').split('.');
    const rest = await readLinkPage(
      await enterLinkPage({ db }, acme.handle, {
        max: 21,
        publicOrigins: origins,
        after: { position: Number(position), id: id ?? '' },
      }),
    );
    expect(rest.items).toHaveLength(5);
  });
});

describe('a form’s redirects', () => {
  const document = (acme: Setup['acme'], changes: Partial<FormDocument>): FormDocument => ({
    ...acme.form.draft,
    ...changes,
  });

  it('refuses another workspace’s address as the after redirect and as a routing rule’s, and keeps the rest', async () => {
    const { acme, home } = await setup();
    const save = (changes: Partial<FormDocument>, revision: number) =>
      saveFormDraft(
        acme.scope,
        { formId: acme.form.id, document: document(acme, changes), expectedRevision: revision },
        [],
        { publicOrigins: origins },
      );
    for (const url of foreign(home)) {
      expect(await refusalOf(save({ after: { kind: 'redirect', url } }, acme.form.revision)), url).toEqual({
        code: 'CONFIG_INVALID',
        message: REFUSAL,
      });
      const rule: RoutingRule = {
        id: 'big',
        when: { join: 'all', rules: [{ key: 'size', op: 'more_than', value: '50' }] },
        then: { kind: 'redirect', url },
      };
      const refused = await refusalOf(save({ routing: { rules: [rule] } }, acme.form.revision));
      expect(refused?.code, url).toBe('CONFIG_INVALID');
      expect(refused?.message, url).toContain('isn’t in this workspace');
    }
    let revision = acme.form.revision;
    for (const url of allowed(acme)) {
      const saved = await save({ after: { kind: 'redirect', url } }, revision);
      revision = saved.revision;
    }
  });
});

describe('a form’s booking target (AC-5613)', () => {
  it('refuses another workspace’s booking page as the after step and as a routing rule’s, through row level security', async () => {
    const { acme, home } = await setup();
    const save = (changes: Partial<FormDocument>) =>
      saveFormDraft(
        acme.scope,
        { formId: acme.form.id, document: { ...acme.form.draft, ...changes }, expectedRevision: acme.form.revision },
        [],
        { publicOrigins: origins },
      );
    const after = await refusalOf(
      save({ after: { kind: 'booking', bookingPageId: home.booking.id, countdownSeconds: 5, message: '' } }),
    );
    expect(after?.code).toBe('CONFIG_INVALID');
    const book: RoutingRule = {
      id: 'book',
      when: { join: 'all', rules: [{ key: 'size', op: 'more_than', value: '50' }] },
      then: { kind: 'book', bookingPageId: home.booking.id, message: '' },
    };
    expect((await refusalOf(save({ routing: { rules: [book] } })))?.code).toBe('CONFIG_INVALID');
  });
});

describe('a form’s thank you', () => {
  it('answers its own message, never a redirect to another workspace’s page that was kept before (AC-5612)', async () => {
    const { acme, home } = await setup();
    const registry = jobKinds({ environment: 'local' });
    const submit = async (publicOrigins: readonly string[]) => {
      const { scope, formId } = await enterPublicForm({ db }, acme.form.publicKey);
      const body: SubmitBody = {
        idempotencyKey: newId(),
        answers: { name: 'Bea', email: `${randomUUID()}@example.com` },
        hidden: {},
        fillMs: 10_000,
      };
      return submitForm(scope, registry, {
        formId,
        body,
        captcha: { kind: 'off' },
        answersKey: 'a-test-answers-key',
        publicOrigins,
      });
    };
    // Kept while no origin was known to the writer, as a form saved before this rule would be.
    const url = foreign(home)[0] ?? '';
    const saved = await saveFormDraft(acme.scope, {
      formId: acme.form.id,
      document: { ...acme.form.draft, after: { kind: 'redirect', url } },
      expectedRevision: acme.form.revision,
    });
    await publishForm(acme.scope, { formId: acme.form.id, expectedRevision: saved.revision });
    expect((await submit([])).next).toEqual({ kind: 'redirect', url });
    expect((await submit(origins)).next).toMatchObject({ kind: 'message', text: '' });
  });
});

describe('the public addresses themselves', () => {
  it('leave /b/:key as it was: a booking page is found by its key from any workspace', async () => {
    const { acme } = await setup();
    const entry = await enterBookingPage({ db }, acme.booking.publicKey);
    expect(entry.pageId).toBe(acme.booking.id);
  });
});
