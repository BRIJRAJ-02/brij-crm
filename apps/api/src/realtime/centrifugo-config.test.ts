// The Centrifugo config Railway and the local stack both run (infra/centrifugo,
// spec 0005): the `workspace` namespace takes subscription tokens only, and
// keeps enough history (1,000 messages for 5 minutes) that a browser that
// reconnects after a busy minute recovers what it missed instead of
// refetching everything. CI runs Centrifugo as a service, which can't take the
// file, so its workspace namespace is written out in ci.yml: the two must agree,
// as must the image both pin.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';

const Config = z.object({
  channel: z.object({
    namespaces: z.array(z.object({ name: z.string() }).loose()),
  }),
});

describe('the Centrifugo config', () => {
  it('keeps 1,000 messages of workspace history for 5 minutes, recovery forced, tokens only', async () => {
    const text = await readFile(new URL('../../../../infra/centrifugo/config.json', import.meta.url), 'utf8');
    const config = Config.parse(JSON.parse(text));
    expect(config.channel.namespaces.find((namespace) => namespace.name === 'workspace')).toEqual({
      name: 'workspace',
      allow_subscribe_for_client: false,
      history_size: 1000,
      history_ttl: '300s',
      force_recovery: true,
    });
  });

  it('is what CI runs: the same namespace, as JSON in the service, and the same image', async () => {
    const read = (path: string) => readFile(new URL(`../../../../${path}`, import.meta.url), 'utf8');
    const [ci, file, dockerfile] = await Promise.all([
      read('.github/workflows/ci.yml'),
      read('infra/centrifugo/config.json'),
      read('infra/centrifugo/Dockerfile'),
    ]);
    const namespaces = /CENTRIFUGO_CHANNEL_NAMESPACES: '(.+)'/.exec(ci)?.[1];
    expect(namespaces).toBeDefined();
    expect(JSON.parse(namespaces ?? 'null')).toEqual(Config.parse(JSON.parse(file)).channel.namespaces);
    const image = /^FROM (centrifugo\/centrifugo:\S+)$/m.exec(dockerfile)?.[1];
    expect(image).toBeDefined();
    expect(ci).toContain(`image: ${image ?? ''}`);
  });
});
