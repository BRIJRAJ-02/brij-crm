// Form file uploads (#32) over HTTP, against a real Postgres and an in memory file store: a visitor's file is kept
// privately under an unguessable key, refused when it isn't what it says or is too big, attached to the one
// submission that takes it, and downloaded only by a member who could open that submission, never across workspaces.
import { FORM_UPLOAD_MAX_BYTES } from '@crm/contracts';
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace } from '../../test/workspace.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import type { FileStore } from '../storage/blob.ts';
import { APP_URL, TEST_EDGE_SECRET } from '../testing.ts';

const { ownerUrl } = inject('testDatabase');

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
const kept = new Map<string, { body: Uint8Array; contentType: string }>();
const store: FileStore = {
  put: (pathname, body, contentType) => {
    kept.set(pathname, { body, contentType });
    return Promise.resolve();
  },
  get: (pathname) => {
    const found = kept.get(pathname);
    if (found === undefined) return Promise.resolve(undefined);
    return Promise.resolve({
      stream: new Blob([found.body]).stream(),
      size: found.body.byteLength,
      contentType: found.contentType,
    });
  },
  remove: (pathnames) => {
    for (const pathname of pathnames) kept.delete(pathname);
    return Promise.resolve();
  },
};

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }, {}, { files: store }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

let ips = 0;
const PDF = new TextEncoder().encode('%PDF-1.7\nhello');

function send(
  path: string,
  init: { method?: string; body?: Blob | string; origin?: string; headers?: Record<string, string> },
) {
  return Promise.resolve(
    app.fetch(
      new Request(`${APP_URL}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          [EDGE_HEADER]: TEST_EDGE_SECRET,
          [ORIGIN_HEADER]: init.origin ?? APP_URL,
          origin: init.origin ?? APP_URL,
          // A fresh address per test, so the per address limit never reaches across them.
          'x-forwarded-for': init.headers?.['x-forwarded-for'] ?? `203.0.113.${String((ips += 1) % 250)}`,
          ...init.headers,
        },
        ...(init.body === undefined ? {} : { body: init.body }),
      }),
    ),
  );
}

const upload = (key: string, body: Uint8Array, type = 'application/pdf', name = 'CV.pdf', origin?: string) =>
  send(`/api/public/forms/${key}/uploads`, {
    method: 'POST',
    body: new Blob([body]),
    ...(origin === undefined ? {} : { origin }),
    headers: { 'content-type': type, 'x-file-name': encodeURIComponent(name) },
  });

async function formWithFile() {
  const m = await memberWithWorkspace(app);
  const created = await m.client.forms.create({
    workspace: m.slug,
    id: newId(),
    name: 'Apply',
    mainObjectId: m.people.id,
    mutationId: newId(),
  });
  const saved = await m.client.forms.saveDraft({
    workspace: m.slug,
    formId: created.id,
    expectedRevision: created.revision,
    mutationId: newId(),
    document: {
      ...created.draft,
      questions: [
        ...created.draft.questions,
        { id: 'cv', key: 'cv', label: 'Your CV', answerType: 'file', required: false, update: 'fill' },
      ],
    },
  });
  const live = await m.client.forms.publish({
    workspace: m.slug,
    formId: created.id,
    expectedRevision: saved.revision,
    mutationId: newId(),
  });
  return { m, live };
}

const answers = (fileId?: string) => ({
  idempotencyKey: newId(),
  versionNumber: 1,
  answers: { name: 'Ada Lovelace', email: 'ada@example.com', ...(fileId === undefined ? {} : { cv: { fileId } }) },
  hidden: {},
  fillMs: 8_000,
});

const submit = (key: string, body: unknown) =>
  send(`/api/public/forms/${key}/submissions`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

describe('form uploads', () => {
  it('keeps a PDF privately under an unguessable key, bound to its workspace and form', async () => {
    const { m, live } = await formWithFile();
    const response = await upload(live.publicKey, PDF, 'application/pdf', '../../CV  final.pdf');
    expect(response.status).toBe(201);
    const file = (await response.json()) as { fileId: string; name: string; size: number; contentType: string };
    expect(file).toMatchObject({ name: 'CV final.pdf', size: PDF.byteLength, contentType: 'application/pdf' });
    const [row] = await testQuery<{ pathname: string; submission_id: string | null; workspace_id: string }>(
      ownerUrl,
      `select pathname, submission_id, workspace_id from form_uploads where id = $1`,
      [file.fileId],
    );
    expect(row?.workspace_id).toBe(m.workspace.id);
    expect(row?.submission_id).toBeNull();
    expect(row?.pathname).toBe(`forms/${m.workspace.id}/${live.id}/${file.fileId}.pdf`);
    expect(kept.has(row?.pathname ?? '')).toBe(true);
  });

  it('refuses a file that is not what it says, a type off the list, an empty or oversized one, and a foreign Origin', async () => {
    const { live } = await formWithFile();
    const script = new TextEncoder().encode('<script>alert(1)</script>');
    expect((await upload(live.publicKey, script)).status).toBe(400);
    expect((await upload(live.publicKey, script, 'text/html', 'x.html')).status).toBe(400);
    expect((await upload(live.publicKey, new Uint8Array(0))).status).toBe(400);
    const big = new Uint8Array(FORM_UPLOAD_MAX_BYTES + 1);
    big.set(PDF);
    expect((await upload(live.publicKey, big)).status).toBe(413);
    expect((await upload(live.publicKey, PDF, 'application/pdf', 'CV.pdf', 'https://evil.example')).status).toBe(403);
    expect((await upload('no-such-form', PDF)).status).toBe(404);
  });

  it('attaches the file to the one submission that takes it, and a second cannot reuse it', async () => {
    const { m, live } = await formWithFile();
    const file = (await (await upload(live.publicKey, PDF)).json()) as { fileId: string };
    const first = await submit(live.publicKey, answers(file.fileId));
    expect(first.status).toBe(200);
    const [row] = await testQuery<{ submission_id: string | null }>(
      ownerUrl,
      `select submission_id from form_uploads where id = $1`,
      [file.fileId],
    );
    expect(row?.submission_id).not.toBeNull();
    const [stored] = await testQuery<{ answers: { cv: { fileId: string; name: string } } }>(
      ownerUrl,
      `select answers from form_submissions where id = $1`,
      [row?.submission_id],
    );
    expect(stored?.answers.cv).toMatchObject({ fileId: file.fileId, name: 'CV.pdf' });
    const second = await submit(live.publicKey, answers(file.fileId));
    expect(second.status).toBe(422);
    // An id nobody uploaded is refused the same way.
    expect((await submit(live.publicKey, answers(newId()))).status).toBe(422);
    expect(m.slug).toBeTruthy();
  });

  it('lets a member download it as an attachment, and no one else, nor from another workspace', async () => {
    const { m, live } = await formWithFile();
    const file = (await (await upload(live.publicKey, PDF)).json()) as { fileId: string };
    await submit(live.publicKey, answers(file.fileId));
    const path = (slug: string) => `/api/files/${file.fileId}?workspace=${slug}`;
    const own = await send(path(m.slug), { headers: { cookie: m.cookie } });
    expect(own.status).toBe(200);
    expect(own.headers.get('content-disposition')).toContain('attachment');
    expect(own.headers.get('x-content-type-options')).toBe('nosniff');
    expect(own.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(PDF);
    expect((await send(path(m.slug), {})).status).toBe(404);
    const other = await memberWithWorkspace(app);
    expect((await send(path(other.slug), { headers: { cookie: other.cookie } })).status).toBe(404);
    expect((await send(path(m.slug), { headers: { cookie: other.cookie } })).status).toBe(404);
  });

  it('serves an unattached file to no one, and lets the visitor take it back', async () => {
    const { m, live } = await formWithFile();
    const file = (await (await upload(live.publicKey, PDF)).json()) as { fileId: string };
    expect(
      (await send(`/api/files/${file.fileId}?workspace=${m.slug}`, { headers: { cookie: m.cookie } })).status,
    ).toBe(404);
    const removed = await send(`/api/public/forms/${live.publicKey}/uploads/${file.fileId}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);
    const rows = await testQuery(ownerUrl, `select 1 from form_uploads where id = $1`, [file.fileId]);
    expect(rows).toHaveLength(0);
  });
});
