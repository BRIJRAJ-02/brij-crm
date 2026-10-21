import { describe, expect, it, vi } from 'vitest';

type Listener = (context: { readonly code: number }) => void;

const clients: {
  readonly listeners: Map<string, Listener[]>;
  readonly setToken: ReturnType<typeof vi.fn>;
  readonly connect: ReturnType<typeof vi.fn>;
}[] = [];

vi.mock('centrifuge', () => ({
  UnauthorizedError: class extends Error {},
  Centrifuge: vi.fn(function fake() {
    const listeners = new Map<string, Listener[]>();
    const client = {
      listeners,
      setToken: vi.fn(),
      connect: vi.fn(),
      on: (event: string, listener: Listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    };
    clients.push(client);
    return client;
  }),
}));

const { openCentrifuge } = await import('./centrifuge.ts');

const fire = (index: number, code: number) => {
  for (const listener of clients[index]?.listeners.get('disconnected') ?? []) listener({ code });
};

describe('openCentrifuge, signed out elsewhere (4501)', () => {
  it('forgets the connection token and connects again, so the session is checked', () => {
    openCentrifuge('ws://live', () => Promise.resolve('token'));
    fire(0, 4501);
    expect(clients[0]?.setToken).toHaveBeenCalledWith('');
    expect(clients[0]?.connect).toHaveBeenCalledTimes(1);
  });

  it('leaves any other disconnect to the client', () => {
    openCentrifuge('ws://live', () => Promise.resolve('token'));
    fire(1, 4500);
    fire(1, 3000);
    expect(clients[1]?.setToken).not.toHaveBeenCalled();
    expect(clients[1]?.connect).not.toHaveBeenCalled();
  });
});
