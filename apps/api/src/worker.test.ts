// The worker entrypoint refuses to start (spec 0005) when either of its URLs
// is a role that could bypass row level security: the pool's, or the direct
// connection the relay reads and marks rows on; and (spec 0008) when the
// direct login isn't in crm_worker, the group that alone reaches the queue.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, inject, it } from 'vitest';

const { appUrl, ownerUrl, workerUrl } = inject('testDatabase');

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
    expect(output).toContain('can bypass row level security. Point DATABASE_URL_DIRECT at the worker login role');
  });

  it('refuses a direct URL that is the app login, which is not in crm_worker', async () => {
    const { code, output } = await runWorker({
      APP_ENV: 'local',
      DATABASE_URL: appUrl,
      DATABASE_URL_DIRECT: appUrl,
      WORKER_PORT: '3999',
    });
    expect(code).toBe(1);
    expect(output).toContain('Refusing to start');
    expect(output).toContain('is not a member of crm_worker');
  });

  it('boots on the worker login with the job runners, answers /health awake, and stops cleanly', async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.ts', import.meta.url))], {
      env: {
        PATH: process.env.PATH ?? '',
        APP_ENV: 'local',
        DATABASE_URL: appUrl,
        DATABASE_URL_DIRECT: workerUrl,
        WORKER_PORT: '3998',
      },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    try {
      await expect
        .poll(
          async () => {
            const response = await fetch('http://127.0.0.1:3998/health').catch(() => undefined);
            return response?.ok === true ? ((await response.json()) as Record<string, unknown>) : undefined;
          },
          { timeout: 20_000, interval: 200 },
        )
        .toMatchObject({ status: 'ok', state: 'awake' });
      expect(output).toContain('jobs.runners.started');
    } finally {
      child.kill('SIGTERM');
    }
    expect(await exited).toBe(0);
  });
});
