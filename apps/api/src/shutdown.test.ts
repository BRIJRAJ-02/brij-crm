// onShutdown exits the process, so each case runs in a child process that
// registers a cleanup, signals itself, and reports what happened.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SHUTDOWN = pathToFileURL(path.join(import.meta.dirname, 'shutdown.ts')).href;
const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'crm-shutdown-')));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runWithSignals(cleanup: string, signals: NodeJS.Signals[]): Run {
  const child = path.join(dir, `child-${String(Math.random()).slice(2)}.mjs`);
  writeFileSync(
    child,
    [
      `import { onShutdown } from '${SHUTDOWN}';`,
      `onShutdown(${cleanup});`,
      'setInterval(() => {}, 1000);',
      `setTimeout(() => { for (const s of ${JSON.stringify(signals)}) process.kill(process.pid, s); }, 50);`,
    ].join('\n'),
  );
  const result = spawnSync(process.execPath, [child], { encoding: 'utf8', timeout: 8_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function logLines(output: string): { message?: string; signal?: string; error?: { message?: string } }[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as { message?: string; signal?: string; error?: { message?: string } });
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('onShutdown', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)('runs the cleanup once on %s, then exits cleanly', (signal) => {
    const run = runWithSignals("async () => { console.log('cleanup ran'); }", [signal]);
    expect(run.status).toBe(0);
    expect(run.stdout.match(/cleanup ran/g)).toHaveLength(1);
    expect(logLines(run.stdout)).toContainEqual(expect.objectContaining({ message: 'Shutting down', signal }));
  });

  it('runs the cleanup only once when a second signal arrives while it runs', () => {
    const run = runWithSignals(
      "async () => { console.log('cleanup ran'); await new Promise((r) => setTimeout(r, 200)); }",
      ['SIGTERM', 'SIGINT'],
    );
    expect(run.status).toBe(0);
    expect(run.stdout.match(/cleanup ran/g)).toHaveLength(1);
  });

  it('exits with an error and logs why when the cleanup fails', () => {
    const run = runWithSignals("async () => { throw new Error('pool would not close'); }", ['SIGTERM']);
    expect(run.status).toBe(1);
    const failure = logLines(run.stderr).find((line) => line.message === 'Shutdown failed');
    expect(failure?.error?.message).toBe('pool would not close');
  });
});
