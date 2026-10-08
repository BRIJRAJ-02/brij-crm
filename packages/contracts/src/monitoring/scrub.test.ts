// The one scrub every Sentry send hook runs (spec 0010, AC-165): nothing
// personal survives it, and what Sentry needs to group and map an error does.
import { describe, expect, it } from 'vitest';
import { EMAIL_MARK, MAX_TEXT, scrub, scrubText } from './scrub.ts';

/** Freezes a value and everything in it, so a test fails if scrub writes to its argument. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

const EMAIL = 'ada.lovelace+crm@example.co.uk';

/** An event as either SDK builds it, with something personal in every place one can hide. */
function personalEvent() {
  return deepFreeze({
    event_id: 'abc123',
    message: `Duplicate key for ${EMAIL}`,
    environment: 'production',
    release: '5361957',
    tags: { request_id: 'req-1', procedure: 'records.create' },
    request: {
      url: 'https://brij-crm-phi.vercel.app/api/auth/callback/google?code=4/0Ab&state=xyz#token=secret',
      method: 'POST',
      query_string: 'code=4/0Ab&state=xyz',
      cookies: { 'better-auth.session_token': 'session-secret' },
      data: { email: EMAIL, name: 'Ada Lovelace' },
      env: { REMOTE_ADDR: '203.0.113.9' },
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': 'req-1',
        Cookie: 'better-auth.session_token=session-secret',
        Authorization: 'Bearer token-secret',
        'X-Forwarded-For': '203.0.113.9',
        'User-Agent': 'Mozilla/5.0',
      },
    },
    user: { id: 'user-1', email: EMAIL, username: 'ada', ip_address: '203.0.113.9', name: 'Ada Lovelace' },
    extra: { detail: 'Key (email)=(someone@example.com) already exists.', attempt: 2 },
    exception: {
      values: [
        {
          type: 'Error',
          value: `insert failed for ${EMAIL}`,
          stacktrace: {
            frames: [
              {
                filename: 'file:///app/node_modules/.pnpm/@sentry+node@11.5.0_@babel+core@7.29.7/node_modules/x.js',
                abs_path: '/app/apps/api/src/rpc.ts',
                function: 'createRecord',
                lineno: 12,
                vars: { email: EMAIL, body: '{"name":"Ada"}' },
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: 'fetch', data: { url: '/api/rpc/records/query?search=ada', method: 'POST', status_code: 200 } },
      { category: 'http', message: `GET https://api.example.com/v1/people?email=${EMAIL}` },
    ],
  });
}

describe('scrub', () => {
  it('lets nothing personal through', () => {
    const sent = JSON.stringify(scrub(personalEvent()));
    for (const secret of [
      EMAIL,
      'someone@example.com',
      'session-secret',
      'token-secret',
      '203.0.113.9',
      'Ada Lovelace',
      '"ada"',
      'code=4/0Ab',
      'state=xyz',
      'token=secret',
      'search=ada',
      '{\\"name\\":\\"Ada\\"}',
      'Mozilla',
    ]) {
      expect(sent).not.toContain(secret);
    }
  });

  it('drops cookies, the body, the query string and the environment from the request, and all but two headers', () => {
    const { request } = scrub(personalEvent());
    expect(request).toEqual({
      url: 'https://brij-crm-phi.vercel.app/api/auth/callback/google',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-1' },
    });
  });

  it("keeps only the user's id", () => {
    expect(scrub(personalEvent()).user).toEqual({ id: 'user-1' });
    expect(scrub({ user: { email: EMAIL } })).toEqual({});
  });

  it("drops a Postgres error's detail, and keeps the rest of extra", () => {
    expect(scrub(personalEvent()).extra).toEqual({ attempt: 2 });
  });

  it('marks emails in messages and exception values, and drops local variables', () => {
    const event = scrub(personalEvent());
    expect(event.message).toBe(`Duplicate key for ${EMAIL_MARK}`);
    const [exception] = event.exception.values;
    expect(exception?.value).toBe(`insert failed for ${EMAIL_MARK}`);
    expect(exception?.stacktrace.frames[0]).not.toHaveProperty('vars');
  });

  it('leaves what Sentry groups and maps by untouched: ids, tags, release and stack frame files', () => {
    const event = scrub(personalEvent());
    const original = personalEvent();
    expect(event.event_id).toBe(original.event_id);
    expect(event.tags).toEqual(original.tags);
    expect(event.release).toBe(original.release);
    const [frame] = event.exception.values[0]?.stacktrace.frames ?? [];
    const [originalFrame] = original.exception.values[0]?.stacktrace.frames ?? [];
    expect(frame?.filename).toBe(originalFrame?.filename);
    expect(frame?.abs_path).toBe('/app/apps/api/src/rpc.ts');
    expect(frame?.function).toBe('createRecord');
    expect(frame?.lineno).toBe(12);
  });

  it("cuts the query from a breadcrumb's URL and from URLs in its message", () => {
    const [fetchCrumb, httpCrumb] = scrub(personalEvent()).breadcrumbs;
    expect(fetchCrumb?.data).toEqual({ url: '/api/rpc/records/query', method: 'POST', status_code: 200 });
    expect(httpCrumb?.message).toBe('GET https://api.example.com/v1/people');
  });

  it('scrubs a breadcrumb on its own, as beforeBreadcrumb hands it', () => {
    expect(scrub({ category: 'ui.click', message: `button[title="${EMAIL}"]` })).toEqual({
      category: 'ui.click',
      message: `button[title="${EMAIL_MARK}"]`,
    });
  });

  it('never changes its argument', () => {
    const event = personalEvent();
    expect(() => scrub(event)).not.toThrow();
    expect(event.user.email).toBe(EMAIL);
  });

  it('cuts a cycle instead of walking it forever', () => {
    const extra: Record<string, unknown> = { note: EMAIL };
    extra.self = extra;
    expect(scrub({ extra })).toEqual({ extra: { note: EMAIL_MARK, self: '[cut]' } });
  });
});

describe('scrubText on long and hostile text', () => {
  const MEGABYTE = 1024 * 1024;

  it.each([
    ['slashes', '/'],
    ['dotted labels', 'a.'],
    ['at signs', 'a@'],
    ['a path then a query', '/a?b'],
  ])('scrubs a megabyte of %s in well under a frame', (_name, unit) => {
    const text = unit.repeat(MEGABYTE / unit.length);
    const started = performance.now();
    const scrubbed = scrubText(text);
    expect(performance.now() - started).toBeLessThan(50);
    expect(scrubbed.length).toBeLessThanOrEqual(MAX_TEXT + '[cut]'.length);
  });

  it('cuts a long text, and still marks an email that straddles the cut', () => {
    const email = 'ada.lovelace@example.com';
    const text = `${'x '.repeat((MAX_TEXT - 6) / 2)}${email} and more`;
    const scrubbed = scrubText(text);
    expect(scrubbed.endsWith('[cut]')).toBe(true);
    expect(scrubbed).not.toContain('ada.lovelace@');
    expect(scrubbed).not.toContain('@example');
  });
});

describe('scrubText', () => {
  it.each([
    ['/verify?email=a@b.co&code=123456', '/verify'],
    ['https://app.test/w/acme?tab=deals#notes', 'https://app.test/w/acme'],
    ['reach me at a.b-c@mail.example.com today', `reach me at ${EMAIL_MARK} today`],
    ['connect ECONNREFUSED 10.0.0.7:5432', 'connect ECONNREFUSED 10.0.0.7:5432'],
    ['Is it ready? Yes.', 'Is it ready? Yes.'],
    [
      'Failed query: select "id" from "sessions" where "token" = $1\nparams: tok_secret,ada@example.com',
      'Failed query: select "id" from "sessions" where "token" = $1',
    ],
  ])('turns %s into %s', (text, expected) => {
    expect(scrubText(text)).toBe(expected);
  });
});
