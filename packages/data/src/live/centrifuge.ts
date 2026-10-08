// Centrifugo's browser client, its one wrapper (spec 0005): the only module
// that imports `centrifuge`. live.ts loads it with a dynamic import the first
// time a screen watches a workspace, so it stays out of the first load. The
// client reconnects by itself with backoff, and resubscribes with recovery
// (the `workspace` namespace forces it), so what this hands live.ts is only
// what happened: a publication, subscribed (recovered or not), or down.
import { Centrifuge, UnauthorizedError } from 'centrifuge';
import type { LiveChannel, LiveTransport, OpenTransport, TokenSource } from './live.ts';

/** A token callback for the client: no token (signed out, or no longer a member) stops trying. */
const tokenFor = (source: TokenSource) => async (): Promise<string> => {
  const token = await source();
  if (token === undefined) throw new UnauthorizedError('Not allowed to listen.');
  return token;
};

/** Connects to Centrifugo at `url` (the WebSocket endpoint) once the first channel is listened to. */
export const openCentrifuge: OpenTransport = (url, connectionToken) => {
  const client = new Centrifuge(url, { getToken: tokenFor(connectionToken) });
  let isOpen = false;
  const transport: LiveTransport = {
    listen: (channel: LiveChannel) => {
      const subscription = client.newSubscription(channel.name, {
        token: channel.token,
        getToken: tokenFor(channel.renew),
      });
      subscription.on('publication', (context) => {
        channel.onPublication(context.data);
      });
      subscription.on('subscribed', (context) => {
        channel.onSubscribed({ wasRecovering: context.wasRecovering, recovered: context.recovered });
      });
      // Subscribing again (the connection dropped, or the server asked); the first subscribing is the start.
      subscription.on('subscribing', () => {
        channel.onDown('resubscribing');
      });
      // Refused for good (no token), or failing to subscribe: paused until subscribed.
      subscription.on('unsubscribed', () => {
        channel.onDown('failed');
      });
      subscription.on('error', () => {
        channel.onDown('failed');
      });
      subscription.subscribe();
      if (!isOpen) {
        isOpen = true;
        client.connect();
      }
      return () => {
        subscription.removeAllListeners();
        subscription.unsubscribe();
        client.removeSubscription(subscription);
      };
    },
    onTrouble: (listener) => {
      // The connection failed or dropped (its subscriptions say so too once they had subscribed).
      const failed = () => {
        listener();
      };
      client.on('error', failed);
      client.on('disconnected', failed);
      return () => {
        client.off('error', failed);
        client.off('disconnected', failed);
      };
    },
    close: () => {
      client.removeAllListeners();
      client.disconnect();
    },
  };
  return transport;
};
