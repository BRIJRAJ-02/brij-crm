// The names of linked records: asked for in render, read once per frame in
// batches, kept for the app load, read again after a live change.
import { describe, expect, it, vi } from 'vitest';
import { createReferenceNames } from './names.ts';

const ACME = { objectId: 'companies', recordId: 'acme' };
const GLOBEX = { objectId: 'companies', recordId: 'globex' };
const HIDDEN = { objectId: 'companies', recordId: 'hidden' };
const display = (recordId: string, name: string) =>
  ({ objectId: 'companies', recordId, name, kind: 'company' }) as const;

function setup(names: Readonly<Record<string, string>> = { acme: 'Acme', globex: 'Globex' }) {
  const frames: (() => void)[] = [];
  const read = vi.fn((_workspace: string, ids: readonly string[]) =>
    Promise.resolve(
      ids.flatMap((id) => (names[id] === undefined ? [] : [{ id, display: display(id, names[id] ?? '') }])),
    ),
  );
  const onNames = vi.fn();
  const reader = createReferenceNames({ read, onNames, schedule: (flush) => frames.push(flush) });
  const frame = async () => {
    for (const flush of frames.splice(0)) flush();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { reader, read, onNames, frame, frames };
}

describe('reference names', () => {
  it('reads the names asked for in one frame in one call, then answers them', async () => {
    const { reader, read, onNames, frame } = setup();
    expect(reader.displaysOf('ws', [ACME, GLOBEX])).toEqual(['loading', 'loading']);
    expect(reader.displaysOf('ws', [ACME])).toEqual(['loading']);
    await frame();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('ws', ['acme', 'globex']);
    expect(onNames).toHaveBeenCalledWith('ws');
    expect(reader.displaysOf('ws', [ACME, GLOBEX])).toEqual([display('acme', 'Acme'), display('globex', 'Globex')]);
    // Known now: no second read.
    await frame();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('says unknown for a record the read leaves out (hidden or deleted), and never reads it again this load', async () => {
    const { reader, read, frame } = setup();
    reader.displaysOf('ws', [HIDDEN]);
    await frame();
    expect(reader.displaysOf('ws', [HIDDEN])).toEqual(['unknown']);
    await frame();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads a name again after a live change forgets it', async () => {
    const names: Record<string, string> = { acme: 'Acme' };
    const { reader, read, frame } = setup(names);
    reader.displaysOf('ws', [ACME]);
    await frame();
    names.acme = 'Acme Corp';
    reader.forget('ws', ['acme']);
    expect(reader.displaysOf('ws', [ACME])).toEqual(['loading']);
    await frame();
    expect(read).toHaveBeenCalledTimes(2);
    expect(reader.displaysOf('ws', [ACME])).toEqual([display('acme', 'Acme Corp')]);
  });

  it('reads every name of a workspace again once forgetAll drops them, a read already out included', async () => {
    const names: Record<string, string> = { acme: 'Acme', globex: 'Globex' };
    const { reader, read, onNames, frame, frames } = setup(names);
    reader.displaysOf('ws', [ACME]);
    await frame();
    // Globex's read is out (sent, not landed) when the object's name attribute changes: what it brings is dropped.
    reader.displaysOf('ws', [GLOBEX]);
    for (const flush of frames.splice(0)) flush();
    names.acme = 'ACM-1';
    names.globex = 'GLX-1';
    onNames.mockClear();
    reader.forgetAll('ws');
    expect(onNames).toHaveBeenCalledWith('ws');
    await frame();
    expect(reader.displaysOf('ws', [ACME, GLOBEX])).toEqual(['loading', 'loading']);
    await frame();
    expect(reader.displaysOf('ws', [ACME, GLOBEX])).toEqual([display('acme', 'ACM-1'), display('globex', 'GLX-1')]);
    expect(read).toHaveBeenLastCalledWith('ws', ['acme', 'globex']);
  });

  it('tries a failed read again after a wait, twice, then says unknown rather than loading for ever', async () => {
    const frames: (() => void)[] = [];
    const waits: (() => void)[] = [];
    const read = vi.fn(() => Promise.reject(new Error('offline')));
    const onNames = vi.fn();
    const reader = createReferenceNames({
      read,
      onNames,
      schedule: (flush) => frames.push(flush),
      later: (run) => waits.push(run),
    });
    const round = async () => {
      reader.displaysOf('ws', [ACME]);
      for (const flush of frames.splice(0)) flush();
      await Promise.resolve();
      await Promise.resolve();
    };
    await round();
    expect(waits).toHaveLength(1);
    waits.splice(0).forEach((run) => {
      run();
    });
    expect(onNames).toHaveBeenCalledTimes(1);
    await round();
    await round();
    expect(read).toHaveBeenCalledTimes(3);
    expect(reader.displaysOf('ws', [ACME])).toEqual(['unknown']);
  });

  it('keeps each workspace apart, and forgets everything on clear', async () => {
    const { reader, read, frame } = setup();
    reader.displaysOf('ws', [ACME]);
    await frame();
    expect(reader.displaysOf('other', [ACME])).toEqual(['loading']);
    reader.clear();
    expect(reader.displaysOf('ws', [ACME])).toEqual(['loading']);
    await frame();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
