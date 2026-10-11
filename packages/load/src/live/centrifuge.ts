// Centrifugo's client for the harness, its one wrapper (spec 0011, AC-200):
// the only module that imports `centrifuge` and `ws`. Each simulated user
// holds one connection and its workspace channel's subscription, as a
// browser tab does, over `ws` so the handshake carries the API's `Origin`
// like a browser's (Centrifugo checks it). Tokens come from the API through
// the callbacks, again whenever Centrifugo asks for fresh ones. What it hands
// the live client is only what happened: a publication, subscribed
// (recovered or not), or an unplanned drop.
import { Centrifuge, type StreamPosition } from 'centrifuge';
import WebSocket from 'ws';

/** A place in a channel's stream: its epoch and an offset, where a recovering subscription starts from. */
export type { StreamPosition } from 'centrifuge';

/** What a connection reports. */
export interface LiveHandlers {
  readonly publication: (data: unknown) => void;
  readonly subscribed: (info: { readonly wasRecovering: boolean; readonly recovered: boolean }) => void;
  /** The connection or subscription dropped or failed without the harness asking: an unexpected error. */
  readonly trouble: (reason: string) => void;
}

/** What a connection is opened with. */
export interface LiveConnectionOptions {
  /** Centrifugo's WebSocket endpoint (`LOAD_CENTRIFUGO_URL`). */
  readonly url: string;
  /** The `Origin` the handshake carries: the API's, as the browser's page would. */
  readonly origin: string;
  /** A connection token from `realtime.connectionToken`. */
  readonly connectionToken: () => Promise<string>;
  readonly channel: string;
  /** The first subscription token, from `realtime.subscriptionToken`. */
  readonly token: string;
  /** A fresh subscription token, when Centrifugo asks for one. */
  readonly renew: () => Promise<string>;
  /** Where to recover from: the position the user's last connection reached (the storm's reconnect). */
  readonly since?: StreamPosition;
  readonly handlers: LiveHandlers;
}

/** One open connection. */
export interface LiveConnection {
  /** The stream position reached: the epoch subscribed to and the last publication's offset. */
  readonly position: () => StreamPosition | undefined;
  /** Closes it on purpose: nothing it does after counts as trouble. */
  readonly close: () => void;
}

/** Opens a connection. */
export type OpenLiveConnection = (options: LiveConnectionOptions) => LiveConnection;

/** `ws`'s WebSocket, opened with `origin`, as Centrifugo's client constructs it (`new websocket(url, protocol)`). */
function websocketFrom(origin: string): typeof WebSocket {
  return new Proxy(WebSocket, {
    construct: (target, args: unknown[]) =>
      new target(String(args[0]), typeof args[1] === 'string' ? args[1] : undefined, { origin }),
  });
}

/** Connects to Centrifugo and subscribes to the channel. */
export const openLiveConnection: OpenLiveConnection = (options) => {
  const client = new Centrifuge(options.url, {
    websocket: websocketFrom(options.origin),
    getToken: options.connectionToken,
  });
  let closed = false;
  let connected = false;
  let epoch = options.since?.epoch;
  let offset = options.since?.offset;
  const trouble = (reason: string) => {
    if (!closed) options.handlers.trouble(reason);
  };
  const subscription = client.newSubscription(options.channel, {
    token: options.token,
    getToken: options.renew,
    ...(options.since === undefined ? {} : { since: options.since }),
  });
  subscription.on('publication', (context) => {
    if (context.offset !== undefined) offset = context.offset;
    options.handlers.publication(context.data);
  });
  subscription.on('subscribed', (context) => {
    if (context.streamPosition !== undefined) {
      epoch = context.streamPosition.epoch;
      offset ??= context.streamPosition.offset;
    }
    options.handlers.subscribed({ wasRecovering: context.wasRecovering, recovered: context.recovered });
  });
  subscription.on('error', (context) => trouble(`subscription ${context.type}`));
  client.on('connected', () => {
    connected = true;
  });
  // Connecting again after being connected: the connection dropped.
  client.on('connecting', () => {
    if (connected) trouble('websocket dropped');
    connected = false;
  });
  client.on('disconnected', (context) => trouble(`disconnected ${String(context.code)}`));
  client.on('error', (context) => trouble(`websocket ${context.type}`));
  subscription.subscribe();
  client.connect();
  return {
    position: () => (epoch === undefined || offset === undefined ? undefined : { epoch, offset }),
    close: () => {
      closed = true;
      subscription.removeAllListeners();
      client.removeAllListeners();
      client.disconnect();
    },
  };
};
