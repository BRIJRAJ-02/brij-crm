// The RPC error plumbing, end to end: a real oRPC client calls the app, so
// these see exactly what the web app's data layer will see.
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INTERNAL_MESSAGE } from './errors.ts';
import { APP_URL, captureLogs, createTestApp, type LogLine, type testRouter } from './testing.ts';

const app = createTestApp();

const client: RouterClient<typeof testRouter> = createORPCClient(
  new RPCLink({
    url: `${APP_URL}/api/rpc`,
    headers: { origin: APP_URL },
    fetch: async (request) => app.fetch(request),
  }),
);

async function failure(call: () => Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ORPCError) return error;
    throw error;
  }
  throw new Error('The call succeeded.');
}

async function rpc(path: string, body: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.fetch(
    new Request(`${APP_URL}/api/rpc/${path}`, {
      method: 'POST',
      headers: { origin: APP_URL, 'content-type': 'application/json', ...headers },
      body,
    }),
  );
}

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => {
  logs.restore();
});

describe('engine refusals', () => {
  it.each([
    ['NOT_FOUND', 404],
    ['SLUG_TAKEN', 409],
    ['UNIQUE_CONFLICT', 409],
    ['ID_TAKEN', 409],
    ['RECORD_DELETED', 409],
    ['LIMIT_REACHED', 409],
    ['VALUE_REQUIRED', 422],
    ['ATTRIBUTE_VALUE_INVALID', 422],
    ['CONFIG_INVALID', 422],
    ['FILTER_INVALID', 422],
    ['QUERY_CANCELLED', 503],
  ] as const)('answers %s with %i, its message and its refusals', async (code, status) => {
    const error = await failure(() => client.refuse({ codes: [code] }));
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.message).toBe(`Refused with ${code}.`);
    expect(error.data).toEqual({ refusals: [{ code, message: `Refused with ${code}.`, attributeId: 'attribute-0' }] });
  });

  it('lists every refusal, and answers with the first one’s code', async () => {
    const error = await failure(() => client.refuse({ codes: ['VALUE_REQUIRED', 'UNIQUE_CONFLICT'] }));
    expect(error.code).toBe('VALUE_REQUIRED');
    expect(error.status).toBe(422);
    expect(error.data).toEqual({
      refusals: [
        { code: 'VALUE_REQUIRED', message: 'Refused with VALUE_REQUIRED.', attributeId: 'attribute-0' },
        { code: 'UNIQUE_CONFLICT', message: 'Refused with UNIQUE_CONFLICT.', attributeId: 'attribute-1' },
      ],
    });
  });

  it('sends Retry-After with a cancelled query, and not with a conflict', async () => {
    const cancelled = await rpc('refuse', JSON.stringify({ json: { codes: ['QUERY_CANCELLED'] } }));
    expect(cancelled.status).toBe(503);
    expect(cancelled.headers.get('retry-after')).toBe('1');
    const conflict = await rpc('refuse', JSON.stringify({ json: { codes: ['SLUG_TAKEN'] } }));
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get('retry-after')).toBeNull();
  });

  it('logs no expected refusal as a fault', async () => {
    await failure(() => client.refuse({ codes: ['SLUG_TAKEN'] }));
    expect(logs.lines().filter((line) => line.level === 'error')).toEqual([]);
  });
});

describe('input errors', () => {
  it('answers input the contract refuses with 400 INPUT_INVALID and the issues', async () => {
    const error = await failure(() =>
      // @ts-expect-error: deliberately the wrong shape.
      client.echo({ name: '', tags: [1] }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('INPUT_INVALID');
    const { issues } = error.data as { issues: { path: unknown[]; message: string }[] };
    expect(issues.map((issue) => issue.path)).toEqual([['name'], ['tags', 0]]);
    for (const issue of issues) expect(issue.message).not.toBe('');
  });

  it('sends only where and what for each issue, never the input itself', async () => {
    const response = await rpc('echo', JSON.stringify({ json: { name: 42, tags: ['secret-value'] } }));
    const text = await response.text();
    expect(response.status).toBe(400);
    expect(text).not.toContain('secret-value');
    expect(text).not.toContain('"input"');
  });

  it('answers a body that is not JSON with 400 INPUT_INVALID, and logs no fault and none of the body', async () => {
    const response = await rpc('echo', '{"json": {"name": "Ada-secret-body", ');
    expect(response.status).toBe(400);
    const body = (await response.json()) as { json: { code: string; message: string } };
    expect(body.json.code).toBe('INPUT_INVALID');
    expect(logs.lines().filter((line) => line.level === 'error')).toEqual([]);
    expect(logs.lines().find((line) => line.message === 'Unreadable RPC request')).toBeDefined();
    expect(JSON.stringify(logs.lines())).not.toContain('Ada-secret-body');
  });

  it('answers a GET on a procedure that takes POST with 400 INPUT_INVALID, a code from the map', async () => {
    const data = encodeURIComponent(JSON.stringify({ json: { name: 'Ada', tags: [] } }));
    const response = await app.fetch(new Request(`${APP_URL}/api/rpc/echo?data=${data}`));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { json: { code: string } };
    expect(body.json.code).toBe('INPUT_INVALID');
  });
});

describe('unexpected failures', () => {
  function faults(): LogLine[] {
    return logs.lines().filter((line) => line.level === 'error' && line.message === 'Unhandled error');
  }

  it('answers an unknown throw with 500 INTERNAL and no detail, and logs it with the request id', async () => {
    const response = await rpc('crash', JSON.stringify({ json: null }));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      json: { defined: false, code: 'INTERNAL', status: 500, message: INTERNAL_MESSAGE },
    });
    expect(text).not.toMatch(/hunter2|10\.0\.0\.7|stack/);

    const [line] = faults();
    expect(line?.requestId).toBe(response.headers.get('x-request-id'));
    expect(line?.procedure).toBe('crash');
    expect(JSON.stringify(line)).toContain('hunter2');
  });

  it('strips the detail from an INTERNAL thrown on purpose, and still logs it', async () => {
    const error = await failure(() => client.leakyInternal());
    expect(error.status).toBe(500);
    expect(error.message).toBe(INTERNAL_MESSAGE);
    expect(faults()).toHaveLength(1);
  });

  it('turns a code outside the error map into INTERNAL', async () => {
    const error = await failure(() => client.foreignCode());
    expect(error.code).toBe('INTERNAL');
    expect(error.status).toBe(500);
    expect(faults()).toHaveLength(1);
  });

  it('treats something only shaped like a refusal, with an unknown code, as a fault', async () => {
    const error = await failure(() => client.fakeRefusal());
    expect(error.code).toBe('INTERNAL');
    expect(error.status).toBe(500);
    expect(error.data).toBeUndefined();
    expect(faults()).toHaveLength(1);
  });

  it('answers the readiness check with 503 and no detail when the database is unreachable', async () => {
    const response = await app.fetch(new Request(`${APP_URL}/api/health/ready`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
});

describe('the request id', () => {
  it('is fresh for every request, ignores one the caller sent, and reaches the procedure', async () => {
    const first = await rpc('context', JSON.stringify({ json: null }), { 'x-request-id': 'chosen-by-caller' });
    const second = await rpc('context', JSON.stringify({ json: null }));
    const id = first.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).not.toBe(second.headers.get('x-request-id'));
    const body = (await first.json()) as { json: { requestId: string } };
    expect(body.json.requestId).toBe(id);
  });
});
