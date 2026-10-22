// The no secrets in the client check (spec 0045): it finds a server secret's value in a client file, names the
// variable and the file, and never the value; and no server secret can be a VITE_ variable, which Vite would ship.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLeaks, isSecret, needles } from './client-secrets.ts';

const SECRET = 'a-server-secret-of-some-length';
const DATABASE = 'postgresql://crm_app_user:p4ssw0rd-from-neon@ep-x-pooler.ap-southeast-1.aws.neon.tech/crm';

describe('the client secrets check', () => {
  it('finds a secret whose value is in a client file, naming the file', () => {
    const files = [
      { path: 'assets/index.js', content: 'const a = 1;' },
      { path: 'assets/chunk.js', content: `fetch("x", { headers: { k: "${SECRET}" } })` },
    ];
    expect(findLeaks(files, { EDGE_SECRET: SECRET })).toEqual([{ name: 'EDGE_SECRET', file: 'assets/chunk.js' }]);
  });

  it('finds a database URL by its password alone', () => {
    const files = [{ path: 'index.html', content: 'p4ssw0rd-from-neon' }];
    expect(findLeaks(files, { DATABASE_URL: DATABASE })).toEqual([{ name: 'DATABASE_URL', file: 'index.html' }]);
    expect(needles(DATABASE)).toEqual([DATABASE, 'p4ssw0rd-from-neon']);
  });

  it('checks every variable that is not public, so a secret added later is covered without a list', () => {
    const files = [{ path: 'assets/a.js', content: 'k="a-new-provider-key-nobody-listed"' }];
    expect(findLeaks(files, { NEW_PROVIDER_API_KEY: 'a-new-provider-key-nobody-listed' })).toEqual([
      { name: 'NEW_PROVIDER_API_KEY', file: 'assets/a.js' },
    ]);
    expect(isSecret('CENTRIFUGO_API_KEY')).toBe(true);
    expect(isSecret('APP_URL')).toBe(false);
    expect(isSecret('VERCEL_GIT_COMMIT_SHA')).toBe(false);
  });

  it('finds a value a JSON string escaped', () => {
    const value = 'a-secret/with"quote-and-slash';
    const files = [{ path: 'assets/a.js', content: JSON.stringify({ k: value }) }];
    expect(findLeaks(files, { BETTER_AUTH_SECRET: value })).toEqual([
      { name: 'BETTER_AUTH_SECRET', file: 'assets/a.js' },
    ]);
  });

  it('skips a value a VITE_ variable also holds, which the browser gets on purpose', () => {
    const files = [{ path: 'assets/a.js', content: 'site-key-shared-with-the-browser' }];
    expect(
      findLeaks(files, {
        SOME_SERVER_COPY: 'site-key-shared-with-the-browser',
        VITE_SITE_KEY: 'site-key-shared-with-the-browser',
      }),
    ).toEqual([]);
  });

  it('passes clean files, and skips unset, empty and short values that would match by chance', () => {
    const files = [{ path: 'assets/index.js', content: 'production true 1234' }];
    expect(findLeaks(files, { EDGE_SECRET: undefined, RESEND_API_KEY: '', FORMS_IP_SALT: 'true' })).toEqual([]);
    expect(findLeaks(files, { JOBS_RUN_SECRET: SECRET })).toEqual([]);
  });

  it('ignores variables that are not server secrets, such as the public VITE_ ones', () => {
    const files = [{ path: 'assets/index.js', content: 'https://brij-crm-phi.vercel.app' }];
    expect(findLeaks(files, { VITE_APP_URL: 'https://brij-crm-phi.vercel.app' })).toEqual([]);
  });

  it('never counts a VITE_ variable as a secret: Vite hands every one to the browser, so none may hold one', () => {
    expect(isSecret('VITE_REALTIME_URL')).toBe(false);
  });

  it('keeps Vite on its default prefix, so only VITE_ variables reach the client', () => {
    const config = readFileSync(path.join(import.meta.dirname, 'vite.config.ts'), 'utf8');
    expect(config).not.toMatch(/envPrefix/);
    expect(config).not.toMatch(/process\.env\.(?!VITE_)[A-Z_]*SECRET/);
  });
});
