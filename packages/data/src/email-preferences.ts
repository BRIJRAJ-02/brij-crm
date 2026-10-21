// A member's email preferences, as the page an email's link opens reads them
// (the emails lane): no session, only the link's signed token (from the
// link's fragment), sent in a header to `/api/public/email-preferences`, so
// no address bar, log or Referer holds it. One store per token holds the
// page's one copy. A change shows at once, is sent, and is put back with the
// refusal if the server says no; the server's answer for its topic replaces
// the copy's once it lands, unless a change sent after it owns the topic.
// The one click unsubscribe's page has its own small store, which sends its
// token only once the reader says yes.
import type { EmailPreferencesView, EmailTopic, EmailUnsubscribed } from '@crm/contracts/emails';
import { dataError, isFetchFailure, toDataError, type DataError } from './errors.ts';
import type { FetchLike } from './fetch.ts';

export type { EmailPreference, EmailPreferencesView, EmailTopic, EmailUnsubscribed } from '@crm/contracts/emails';

/** The page as a screen reads it: loading, failed (its first read, with its refusal), or the choices. */
export type EmailPreferencesState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | {
      readonly status: 'ready';
      readonly view: EmailPreferencesView;
      /** Topics with a change on its way. */
      readonly saving: ReadonlySet<EmailTopic>;
      /** The last change the server refused, put back; cleared by the next change. */
      readonly refused?: DataError;
    };

/** One link's preferences, as the page holds them. */
export interface EmailPreferencesStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => EmailPreferencesState;
  /** Reads the choices (again, for Try again); for a route loader, it rejects with the refusal. */
  readonly load: () => Promise<void>;
  /** Turns a topic on or off at once, sends it, and puts it back if the server refuses. */
  readonly set: (topic: EmailTopic, subscribed: boolean) => Promise<void>;
}

/** The header the link's token is sent in (the API reads the same name). */
const EMAIL_LINK_HEADER = 'x-crm-email-link';

/** What a store is made on: the app's origin, and `fetch` for tests. */
export interface EmailPreferencesOptions {
  readonly origin: string;
  readonly fetch?: FetchLike;
}

/** A failure answer as a DataError with the API's code and message. */
async function failureOf(response: Response): Promise<DataError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return toDataError({ ...(typeof body === 'object' && body !== null ? body : {}), status: response.status });
}

/** The store for one link's token. */
export function createEmailPreferences(options: EmailPreferencesOptions, token: string): EmailPreferencesStore {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const address = `${options.origin}/api/public/email-preferences`;
  let state: EmailPreferencesState = { status: 'loading' };
  const listeners = new Set<() => void>();
  // Moves with every change sent; an answer to an older one never undoes a newer one.
  const latest = new Map<EmailTopic, number>();
  let sent = 0;

  const publish = (next: EmailPreferencesState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  /** Reads the choices, or sends one change; answers the page as the server has it, or throws the refusal. */
  const call = async (change?: { readonly topic: EmailTopic; readonly subscribed: boolean }) => {
    let response: Response;
    try {
      response = await send(
        address,
        change === undefined
          ? { credentials: 'omit', headers: { [EMAIL_LINK_HEADER]: token } }
          : {
              credentials: 'omit',
              method: 'POST',
              headers: { [EMAIL_LINK_HEADER]: token, 'content-type': 'application/json' },
              body: JSON.stringify(change),
            },
      );
    } catch (error) {
      if (isFetchFailure(error))
        throw dataError('API_UNAVAILABLE', 'You’re offline. Check your connection and try again.');
      throw toDataError(error);
    }
    if (!response.ok) throw await failureOf(response);
    return (await response.json()) as EmailPreferencesView;
  };

  /** One topic's value in a view, if it has the topic. */
  const valueOf = (view: EmailPreferencesView, topic: EmailTopic) =>
    view.preferences.find((each) => each.topic === topic)?.subscribed;

  /** The view with one topic set. */
  const withTopic = (view: EmailPreferencesView, topic: EmailTopic, subscribed: boolean): EmailPreferencesView => ({
    ...view,
    preferences: view.preferences.map((each) => (each.topic === topic ? { ...each, subscribed } : each)),
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    async load() {
      if (state.status !== 'ready') publish({ status: 'loading' });
      try {
        const view = await call();
        const current = state;
        // Read again with changes on their way: those topics keep what they show until their own answers land.
        publish(
          current.status === 'ready'
            ? {
                ...current,
                view: {
                  ...view,
                  preferences: view.preferences.map((each) => {
                    const shown = current.saving.has(each.topic) ? valueOf(current.view, each.topic) : undefined;
                    return shown === undefined ? each : { ...each, subscribed: shown };
                  }),
                },
              }
            : { status: 'ready', view, saving: new Set() },
        );
      } catch (error) {
        const refusal = toDataError(error);
        publish({ status: 'error', error: refusal });
        throw refusal;
      }
    },
    async set(topic, subscribed) {
      if (state.status !== 'ready') return;
      const before = valueOf(state.view, topic);
      sent += 1;
      const mine = sent;
      latest.set(topic, mine);
      publish({
        status: 'ready',
        view: withTopic(state.view, topic, subscribed),
        saving: new Set([...state.saving, topic]),
      });
      const settle = (
        next: (current: Extract<EmailPreferencesState, { status: 'ready' }>) => EmailPreferencesState,
      ) => {
        if (state.status !== 'ready' || latest.get(topic) !== mine) return;
        const saving = new Set(state.saving);
        saving.delete(topic);
        publish(next({ ...state, saving }));
      };
      try {
        const answer = valueOf(await call({ topic, subscribed }), topic);
        // Only this topic's answer: another topic's change may still be on its way, and a refusal shown stays.
        settle((current) => ({
          ...current,
          view: answer === undefined ? current.view : withTopic(current.view, topic, answer),
        }));
      } catch (error) {
        const refusal = toDataError(error);
        settle((current) => ({
          status: 'ready',
          view: before === undefined ? current.view : withTopic(current.view, topic, before),
          saving: current.saving,
          refused: refusal,
        }));
      }
    },
  };
}

/**
 * A one click unsubscribe opened in a browser, as its page holds it: asking
 * (nothing is sent until the reader says so, since link scanners open
 * addresses too), saving, done (the topic and the workspace it is off for),
 * or refused (the link opens nothing any more, or the API can't be reached).
 */
export type EmailUnsubscribeState =
  | { readonly status: 'asking' }
  | { readonly status: 'saving' }
  | { readonly status: 'done'; readonly answer: EmailUnsubscribed }
  | { readonly status: 'error'; readonly error: DataError };

/** One one click link's page: its state, and the reader's yes. */
export interface EmailUnsubscribeStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => EmailUnsubscribeState;
  /** Turns the link's topic off; once done, it does nothing more. After a refusal, it tries again. */
  readonly confirm: () => Promise<void>;
}

/** The store for one one click link's token, posted in the header the API reads it from. */
export function createEmailUnsubscribe(options: EmailPreferencesOptions, token: string): EmailUnsubscribeStore {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let state: EmailUnsubscribeState = { status: 'asking' };
  const listeners = new Set<() => void>();
  const publish = (next: EmailUnsubscribeState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    async confirm() {
      if (state.status === 'saving' || state.status === 'done') return;
      publish({ status: 'saving' });
      try {
        let response: Response;
        try {
          response = await send(`${options.origin}/api/public/email-preferences/unsubscribe`, {
            method: 'POST',
            credentials: 'omit',
            headers: { [EMAIL_LINK_HEADER]: token },
          });
        } catch (error) {
          if (isFetchFailure(error))
            throw dataError('API_UNAVAILABLE', 'You’re offline. Check your connection and try again.');
          throw toDataError(error);
        }
        if (!response.ok) throw await failureOf(response);
        publish({ status: 'done', answer: (await response.json()) as EmailUnsubscribed });
      } catch (error) {
        publish({ status: 'error', error: toDataError(error) });
      }
    },
  };
}
