// The files under `.load/` (spec 0011, AC-210): readable by this user only,
// even when a looser folder or file was there before.
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readSessions, writeSessions } from './load-files.ts';
import { isLoadRefusal } from './load-local.ts';

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const mode = async (path: string) => (await stat(path)).mode & 0o777;

async function loadDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'crm-load-files-'));
  roots.push(root);
  return join(root, '.load');
}

const sessions = () => ({
  apiUrl: 'http://localhost:3100',
  mintedAt: new Date().toISOString(),
  sessions: { '1': 'better-auth.session_token=x' },
});

describe('writing .load files', () => {
  it('makes the folder 0700 and the file 0600', async () => {
    const dir = await loadDir();
    const path = await writeSessions(dir, sessions());
    expect(await mode(dir)).toBe(0o700);
    expect(await mode(path)).toBe(0o600);
  });

  it('tightens a folder and a file that were there before with looser modes', async () => {
    const dir = await loadDir();
    await mkdir(dir);
    await chmod(dir, 0o755);
    await writeFile(join(dir, 'sessions.json'), '{}');
    await chmod(join(dir, 'sessions.json'), 0o644);
    const path = await writeSessions(dir, sessions());
    expect(await mode(dir)).toBe(0o700);
    expect(await mode(path)).toBe(0o600);
  });
});

describe('reading .load/sessions.json', () => {
  it('reads what was written, and refuses (exit 3, naming load:sessions) a missing or malformed file', async () => {
    const dir = await loadDir();
    const written = sessions();
    await writeSessions(dir, written);
    expect(await readSessions(dir)).toEqual(written);
    const missing = await readSessions(await loadDir()).catch((error: unknown) => error);
    expect(isLoadRefusal(missing) && missing.exitCode === 3 && missing.message.includes('pnpm load:sessions')).toBe(
      true,
    );
    await writeFile(join(dir, 'sessions.json'), JSON.stringify({ apiUrl: 'not a url', sessions: {} }));
    const malformed = await readSessions(dir).catch((error: unknown) => error);
    expect(isLoadRefusal(malformed) && malformed.message.includes('pnpm load:sessions')).toBe(true);
  });
});
