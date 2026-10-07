// The worker entrypoint refuses to start (spec 0005) when either of its URLs
// is a role that could bypass row level security: the pool's, or the direct
// connection the relay reads and marks rows on.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, inject, it } from 'vitest';

const { appUrl, ownerUrl } = inject('testDatabase');

/** Runs the worker with `env` until it exits (or 20 seconds pass), and returns its exit code and output. */
function runWorker(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.ts', import.meta.url))], {
      env: { PATH: process.env.PATH ?? '', ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const timer = setTimeout(() => child.kill('SIGTERM'), 20_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

describe('the worker at startup', () => {
  it('refuses a direct URL whose role bypasses row level security, naming DATABASE_URL_DIRECT', async () => {
    const { code, output } = await runWorker({
      APP_ENV: 'local',
      DATABASE_URL: appUrl,
      DATABASE_URL_DIRECT: ownerUrl,
      WORKER_PORT: '3999',
    });
    expect(code).toBe(1);
    expect(output).toContain('Refusing to start');
    expect(output).toContain('can bypass row level security. Point DATABASE_URL_DIRECT at the app login role');
  });
});
