// The direct connection (spec 0005): the worker proves once, at boot, that a
// NOTIFY arrives on it (a pooler would swallow it); the relay's connections,
// opened each time it wakes, skip the proof and its second connection.
import pg from 'pg';
import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import { openDirectConnection } from './direct.ts';

const { appUrl } = inject('testDatabase');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openDirectConnection', () => {
  it('proves a NOTIFY arrives with a second connection, unless told not to', async () => {
    const connects = vi.spyOn(pg.Client.prototype, 'connect');
    const proved = await openDirectConnection({ url: appUrl, applicationName: 'crm-direct-tests' });
    await proved.end();
    expect(connects).toHaveBeenCalledTimes(2);

    connects.mockClear();
    const plain = await openDirectConnection({ url: appUrl, applicationName: 'crm-direct-tests', proveListen: false });
    try {
      expect(connects).toHaveBeenCalledTimes(1);
      expect((await plain.query<{ one: number }>('select 1 as one')).rows).toEqual([{ one: 1 }]);
    } finally {
      await plain.end();
    }
  });

  it('refuses a Neon pooler host either way', async () => {
    const pooled = 'postgres://u:p@ep-cool-name-123456-pooler.ap-southeast-1.aws.neon.tech/crm';
    for (const proveListen of [true, false]) {
      await expect(openDirectConnection({ url: pooled, applicationName: 'x', proveListen })).rejects.toThrow(
        /points at the Neon pooler/,
      );
    }
  });
});
