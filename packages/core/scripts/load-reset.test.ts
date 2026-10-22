// `pnpm load:reset`'s setup refusal (spec 0011, AC-209, AC-210): an owner
// address that isn't this machine ends it with exit 3 before it reads the
// manifest or opens a connection. Called in process: the refusal is the
// first thing `runLoadReset` does.
import { describe, expect, it } from 'vitest';
import { isLoadRefusal } from './load-local.ts';
import { runLoadReset } from './load-reset.ts';

describe('load:reset', () => {
  it('refuses a remote owner database with exit 3', async () => {
    const error: unknown = await runLoadReset({
      LOAD_DATABASE_URL_OWNER: 'postgres://crm_owner:x@db.example.com:5434/crm',
    }).catch((caught: unknown) => caught);
    expect(isLoadRefusal(error) && error.exitCode).toBe(3);
    expect(error instanceof Error && error.message).toContain('Refusing LOAD_DATABASE_URL_OWNER');
  });
});
