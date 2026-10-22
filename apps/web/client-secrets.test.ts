// The no secrets in the client check (spec 0045): it finds a server secret's value in a client file, names the
// variable and the file, and never the value; and no server secret can be a VITE_ variable, which Vite would ship.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLeaks, needles, SERVER_SECRETS } from './client-secrets.ts';

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

  it('passes clean files, and skips unset, empty and short values that would match by chance', () => {
    const files = [{ path: 'assets/index.js', content: 'production true 1234' }];
    expect(findLeaks(files, { EDGE_SECRET: undefined, RESEND_API_KEY: '', FORMS_IP_SALT: 'true' })).toEqual([]);
    expect(findLeaks(files, { JOBS_RUN_SECRET: SECRET })).toEqual([]);
  });

  it('ignores variables that are not server secrets, such as the public VITE_ ones', () => {
    const files = [{ path: 'assets/index.js', content: 'https://brij-crm-phi.vercel.app' }];
    expect(findLeaks(files, { VITE_APP_URL: 'https://brij-crm-phi.vercel.app' })).toEqual([]);
  });

  it('lists no server secret under a VITE_ name, since Vite hands every VITE_ variable to the browser', () => {
    expect(SERVER_SECRETS.filter((name) => name.startsWith('VITE_'))).toEqual([]);
  });

  it('keeps Vite on its default prefix, so only VITE_ variables reach the client', () => {
    const config = readFileSync(path.join(import.meta.dirname, 'vite.config.ts'), 'utf8');
    expect(config).not.toMatch(/envPrefix/);
    expect(config).not.toMatch(/process\.env\.(?!VITE_)[A-Z_]*SECRET/);
  });
});
