// The worker entrypoint refuses to start (spec 0005) when either of its URLs
// is a role that could bypass row level security: the pool's, or the direct
// connection the relay reads and marks rows on. A direct login outside
// crm_worker (spec 0008) still boots, with the jobs off, as JOBS_RUNNER=off does.
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

  it.each([
    ['on the worker login', { DATABASE_URL_DIRECT: workerUrl }, 'on', undefined],
    [
      'on the app login (not in crm_worker), with its jobs off',
      { DATABASE_URL_DIRECT: appUrl },
      'off',
      'the direct login is not in crm_worker; run pnpm db:worker-login',
    ],
    [
      'with JOBS_RUNNER=off, with its jobs off',
      { DATABASE_URL_DIRECT: workerUrl, JOBS_RUNNER: 'off' },
      'off',
      'JOBS_RUNNER is off',
    ],
  ] as const)('boots %s, answers /health with the jobs %s, and stops cleanly', async (_name, env, jobs, reason) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.ts', import.meta.url))], {
      env: { PATH: process.env.PATH ?? '', APP_ENV: 'local', DATABASE_URL: appUrl, WORKER_PORT: '3998', ...env },
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
        .toMatchObject({ status: 'ok', state: 'awake', jobs });
      if (reason === undefined) {
        expect(output).toContain('jobs.runners.started');
        expect(output).not.toContain('jobs.off');
      } else {
        expect(output).toContain('"message":"jobs.off"');
        expect(output).toContain(reason);
        expect(output).not.toContain('jobs.runners.started');
      }
    } finally {
      child.kill('SIGTERM');
    }
    expect(await exited).toBe(0);
  });
});
