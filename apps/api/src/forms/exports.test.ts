// Spec 0023 follow-up: a submissions export over HTTP, against a real
// Postgres. The RPC starts it (the export's row and its job), the file's text
// stands in for the job's chunks, and the download answers its starter with
// the file (CSV headers, never cached or sniffed) and anyone else, signed out
// or in another workspace, with the same 404.
import { exportDownloadPath } from '@crm/contracts';
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace } from '../../test/workspace.ts';
import { EDGE_HEADER } from '../edge.ts';
import { APP_URL, TEST_EDGE_SECRET } from '../testing.ts';

const { ownerUrl } = inject('testDatabase');

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }, {}, { wakeRelay: () => undefined }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const download = (path: string, cookie?: string) =>
  Promise.resolve(
    app.fetch(
      new Request(`${APP_URL}${path}`, {
        headers: { [EDGE_HEADER]: TEST_EDGE_SECRET, ...(cookie === undefined ? {} : { cookie }) },
      }),
    ),
  );

describe('GET /api/exports/:id/download', () => {
  it('gives its starter the file and everyone else the same 404', async () => {
    const m = await memberWithWorkspace(app);
    const form = await m.client.forms.create({
      workspace: m.slug,
      id: newId(),
      name: 'Contact: us',
      mainObjectId: m.people.id,
      mutationId: newId(),
    });
    await m.client.forms.publish({
      workspace: m.slug,
      formId: form.id,
      expectedRevision: form.revision,
      mutationId: newId(),
    });
    const id = newId();
    const started = await m.client.submissions.export({
      workspace: m.slug,
      id,
      formId: form.id,
      select: { kind: 'filter' },
      mutationId: newId(),
    });
    expect(started).toMatchObject({ id, downloadPath: exportDownloadPath(m.slug, id) });
    expect(started.fileName).toMatch(/^Contact us - submissions - /u);
    // Not written yet: 404.
    expect((await download(started.downloadPath, m.cookie)).status).toBe(404);

    // The job's work, as it leaves it: two chunks and the row count.
    await testQuery(ownerUrl, `update exports set row_count = 1, byte_count = 10 where id = $1`, [id]);
    await testQuery(
      ownerUrl,
      `insert into export_chunks (workspace_id, export_id, part, body)
       select workspace_id, id, 0, $2 from exports where id = $1
       union all select workspace_id, id, 1, $3 from exports where id = $1`,
      [id, '\uFEFFName\r\n', "'=1+1\r\n"],
    );
    const ok = await download(started.downloadPath, m.cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ok.headers.get('content-disposition')).toMatch(/^attachment; filename="Contact us - submissions - /u);
    // Decoded keeping the byte order mark, which Excel needs to read UTF-8.
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await ok.arrayBuffer())).toBe("\uFEFFName\r\n'=1+1\r\n");
    expect((await m.client.submissions.getExport({ workspace: m.slug, exportId: id })).rowCount).toBe(1);

    // Signed out, another workspace's member, or with someone else's export id in their own workspace: 404.
    expect((await download(started.downloadPath)).status).toBe(404);
    const other = await memberWithWorkspace(app);
    expect((await download(started.downloadPath, other.cookie)).status).toBe(404);
    expect((await download(exportDownloadPath(other.slug, id), other.cookie)).status).toBe(404);
    // Expired: 404 too.
    await testQuery(ownerUrl, `update exports set expires_at = now() - interval '1 second' where id = $1`, [id]);
    expect((await download(started.downloadPath, m.cookie)).status).toBe(404);
  });
});
