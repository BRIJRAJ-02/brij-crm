// Better Auth's own log lines (spec 0010, AC-165): it logs a failed query's
// raw message, drizzle's `Failed query: …\nparams: …`, so a session token or
// an email would reach Railway's logs. They are scrubbed first.
import { describe, expect, it } from 'vitest';
import { captureLogs } from '../testing.ts';
import { logLibrary } from './auth.ts';

const TOKEN = 'tok_9f2c1e7a4b8d4c3e9a1f6b2d7c5e8a0f';

describe("Better Auth's log lines", () => {
  it("keep a failed query's statement and lose its values and any email", () => {
    const logs = captureLogs();
    try {
      logLibrary(
        'error',
        `Failed query: select "id" from "auth"."session" where "token" = $1 and "email" = $2\nparams: ${TOKEN},ada@example.com`,
      );
      logLibrary('warn', 'relation "auth.verification" does not exist for ada@example.com');
    } finally {
      logs.restore();
    }
    const [failed, missing] = logs.lines();
    expect(failed).toMatchObject({
      level: 'error',
      message: 'Sign in library',
      detail: 'Failed query: select "id" from "auth"."session" where "token" = $1 and "email" = $2',
    });
    expect(missing).toMatchObject({ level: 'warn', detail: 'relation "auth.verification" does not exist for [email]' });
    const written = JSON.stringify(logs.lines());
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain('ada@example.com');
  });
});
