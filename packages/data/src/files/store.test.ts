import type { RecordFiles, RecordFileView } from '@crm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createMutationLog } from '../live/mutations.ts';
import type { Notice } from '../notice.ts';
import { createFilesStore, type FilesApi, type SendOutcome } from './store.ts';

const W = 'acme';
const R = '01900000-0000-7000-8000-000000000001';

const file = (id: string, createdAt: string): RecordFileView => ({
  fileId: id,
  recordId: R,
  name: `${id}.pdf`,
  size: 10,
  contentType: 'application/pdf',
  createdAt,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(overrides: Partial<FilesApi> = {}) {
  let ids = 0;
  const notices: Notice[] = [];
  let listed: RecordFiles = { files: [file('a', '2026-10-31T10:00:00.000Z')], canChange: true };
  const api: FilesApi = {
    list: vi.fn(() => Promise.resolve(listed)),
    delete: vi.fn((input: { readonly fileId: string }) =>
      Promise.resolve(file(input.fileId, '2026-10-31T10:00:00.000Z')),
    ),
    restore: vi.fn((input: { readonly fileId: string }) =>
      Promise.resolve(file(input.fileId, '2026-10-31T10:00:00.000Z')),
    ),
    send: vi.fn((_input: unknown, onProgress: (percent: number) => void): Promise<SendOutcome> => {
      onProgress(50);
      return Promise.resolve({ ok: true, file: file('b', '2026-10-31T11:00:00.000Z') });
    }),
    ...overrides,
  };
  const store = createFilesStore({
    api,
    mintId: () => `id-${String((ids += 1))}`,
    mutations: createMutationLog(),
    notify: (notice) => notices.push(notice),
    watch: () => () => undefined,
    later: (work: () => void, ms: number) => {
      // The coarse spread and the drop timer: run the spread at once (random is 0), never the 30 second drop.
      if (ms === 0) work();
      return () => undefined;
    },
    random: () => 0,
  });
  return {
    api,
    store,
    notices,
    setListed: (next: RecordFiles) => {
      listed = next;
    },
  };
}

describe('the files store', () => {
  it('reads a record’s files when held, and puts an upload first once it lands', async () => {
    const { store } = setup();
    const source = store.forRecord(W, R);
    source.retain();
    await flush();
    expect(source.getSnapshot()).toMatchObject({ status: 'ready', canChange: true });
    await store.upload(W, R, [new File(['x'], 'b.pdf', { type: 'application/pdf' })]);
    expect(source.getSnapshot().files.map((each) => each.fileId)).toEqual(['b', 'a']);
    expect(source.getSnapshot().sending).toEqual([]);
  });

  it('keeps a refused upload with its reason until dismissed', async () => {
    const { store } = setup({ send: () => Promise.resolve({ ok: false, message: 'Too big.' }) });
    const source = store.forRecord(W, R);
    source.retain();
    await store.upload(W, R, [new File(['x'], 'big.pdf', { type: 'application/pdf' })]);
    const [refused] = source.getSnapshot().sending;
    expect(refused).toMatchObject({ name: 'big.pdf', error: 'Too big.' });
    store.dismiss(W, R, refused?.key ?? '');
    expect(source.getSnapshot().sending).toEqual([]);
  });

  it('deletes at once and puts the file back with a toast when refused', async () => {
    const { store, notices } = setup({ delete: () => Promise.reject(new Error('no')) });
    const source = store.forRecord(W, R);
    source.retain();
    await flush();
    const pending = store.remove(W, R, 'a');
    expect(source.getSnapshot().files).toEqual([]);
    expect(await pending).toBe(false);
    expect(source.getSnapshot().files.map((each) => each.fileId)).toEqual(['a']);
    expect(notices).toHaveLength(1);
  });

  it('brings a deleted file back with Undo', async () => {
    const { store } = setup();
    const source = store.forRecord(W, R);
    source.retain();
    await flush();
    const [shown] = source.getSnapshot().files;
    expect(await store.remove(W, R, 'a')).toBe(true);
    const restoring = store.restore(W, R, shown ?? file('a', '2026-10-31T10:00:00.000Z'));
    // Shown at once, before the answer.
    expect(source.getSnapshot().files.map((each) => each.fileId)).toEqual(['a']);
    expect(await restoring).toBe(true);
    expect(source.getSnapshot().files.map((each) => each.fileId)).toEqual(['a']);
  });

  it('reads a held record again when a files event names it', async () => {
    const { store, api, setListed } = setup();
    const source = store.forRecord(W, R);
    source.retain();
    await flush();
    setListed({ files: [], canChange: true });
    store.changed(W, { seq: 2, at: '2026-10-31T10:00:00.000Z', kind: 'files', recordIds: [R] });
    await flush();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(source.getSnapshot().files).toEqual([]);
  });

  it('shows a record the reader can’t see as unavailable', async () => {
    const { store } = setup({
      list: () => Promise.reject(Object.assign(new Error('gone'), { status: 404, code: 'NOT_FOUND' })),
    });
    const source = store.forRecord(W, R);
    source.retain();
    await flush();
    expect(source.getSnapshot().status).toBe('unavailable');
  });
});
