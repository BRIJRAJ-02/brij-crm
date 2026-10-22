// Account › Sign in and devices' state (spec 0033, milestone 2): two factor on or off,
// backup codes left, and whether this session is fresh for a sensitive
// change. One held value, read when a screen first holds it and again after
// each change. A step up (AC-896) proves who the person is again and makes
// the session fresh for 10 minutes; the screens ask for it inline, in the
// change's own dialog, and then carry on.
import type {
  AccountPasskey,
  AccountSecurity,
  PasskeyAssertion,
  PasskeyRequestOptions,
  SessionFreshness,
  StepUpMethod,
} from '@crm/contracts';
import { refusalSummary, toDataError, type DataError } from '../errors.ts';

/** The calls the store makes. */
export interface AccountSecurityApi {
  readonly get: () => Promise<AccountSecurity>;
  readonly startStepUp: () => Promise<unknown>;
  readonly verifyStepUp: (input: { readonly method: StepUpMethod; readonly code: string }) => Promise<SessionFreshness>;
  /** A passkey step up's challenge (milestone 3). */
  readonly passkeyOptions: () => Promise<{ readonly options: PasskeyRequestOptions }>;
  /** Asks the browser for a passkey to answer it; `cancelled` when the person closed the prompt. */
  readonly passkeyAssertion: (options: PasskeyRequestOptions) => Promise<PasskeyAssertion | 'cancelled'>;
  readonly verifyPasskey: (input: { readonly response: PasskeyAssertion }) => Promise<SessionFreshness>;
  readonly renamePasskey: (input: { readonly id: string; readonly name: string }) => Promise<AccountPasskey>;
  readonly removePasskey: (input: { readonly id: string }) => Promise<unknown>;
}

/** Account › Sign in and devices' state: loading, failed, or as the server last said. */
export type AccountSecurityState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | ({ readonly status: 'ready' } & AccountSecurity);

/** How a step up went: done, or refused with a code and a sentence for the dialog to show. */
export type StepUpResult =
  { readonly ok: true } | { readonly ok: false; readonly code: DataError['code']; readonly message: string };

/** How a passkey step up went: as a code's, or the person closed the browser's prompt (nothing to show). */
export type PasskeyStepUpResult = StepUpResult | { readonly ok: false; readonly code: 'CANCELLED' };

/** Account › Sign in and devices' state, as screens hold it. */
export interface AccountSecurityView {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => AccountSecurityState;
  readonly retain: () => () => void;
  /** Reads it again (after a change, or Try again). */
  readonly reload: () => Promise<void>;
}

/** Whether the session is fresh now: a sensitive change can go ahead without a step up. */
export function isFresh(state: AccountSecurityState, now = Date.now()): boolean {
  if (state.status !== 'ready' || state.session.freshUntil === undefined) return false;
  return Date.parse(state.session.freshUntil) > now;
}

/** The account security store. */
export function createAccountSecurityStore(api: AccountSecurityApi) {
  let state: AccountSecurityState = { status: 'loading' };
  let reading: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const set = (next: AccountSecurityState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const read = (): Promise<void> => {
    reading ??= api
      .get()
      .then(
        (answer) => set({ status: 'ready', ...answer }),
        (error: unknown) => {
          if (state.status !== 'ready') set({ status: 'error', message: toDataError(error).message });
        },
      )
      .finally(() => {
        reading = undefined;
      });
    return reading;
  };
  const refused = (error: unknown): StepUpResult => {
    const failure = toDataError(error);
    return { ok: false, code: failure.code, message: refusalSummary(failure) };
  };

  const view: AccountSecurityView = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain() {
      void read();
      return () => undefined;
    },
    reload: read,
  };

  return {
    view: (): AccountSecurityView => view,
    /** Emails a step up code (two factor off). */
    async sendCode(): Promise<StepUpResult> {
      try {
        await api.startStepUp();
        return { ok: true };
      } catch (error) {
        return refused(error);
      }
    },
    /** Checks a step up code; on success the session is fresh, and the held state says so at once. */
    async verify(method: StepUpMethod, code: string): Promise<StepUpResult> {
      try {
        const session = await api.verifyStepUp({ method, code });
        if (state.status === 'ready') set({ ...state, session });
        // A backup code used up one of the codes.
        if (method === 'backup') void read();
        return { ok: true };
      } catch (error) {
        return refused(error);
      }
    },
    /** A step up by passkey: the challenge, the browser's prompt, then the check. Never throws. */
    async verifyPasskey(): Promise<PasskeyStepUpResult> {
      try {
        const { options } = await api.passkeyOptions();
        const response = await api.passkeyAssertion(options);
        if (response === 'cancelled') return { ok: false, code: 'CANCELLED' };
        const session = await api.verifyPasskey({ response });
        if (state.status === 'ready') set({ ...state, session });
        // The passkey's last use moved.
        void read();
        return { ok: true };
      } catch (error) {
        return refused(error);
      }
    },
    /** Renames a passkey: shown at once, put back if refused. Never throws. */
    async renamePasskey(id: string, name: string): Promise<StepUpResult> {
      const before = state;
      if (before.status === 'ready') {
        set({ ...before, passkeys: before.passkeys.map((each) => (each.id === id ? { ...each, name } : each)) });
      }
      try {
        const renamed = await api.renamePasskey({ id, name });
        if (state.status === 'ready') {
          set({ ...state, passkeys: state.passkeys.map((each) => (each.id === id ? renamed : each)) });
        }
        return { ok: true };
      } catch (error) {
        if (before.status === 'ready' && state.status === 'ready') {
          const old = before.passkeys.find((each) => each.id === id);
          set({ ...state, passkeys: state.passkeys.map((each) => (each.id === id && old !== undefined ? old : each)) });
        }
        return refused(error);
      }
    },
    /**
     * Removes a passkey (after a step up): gone at once, back in its place if
     * refused (STEP_UP_REQUIRED included, for the dialog to ask). Never throws.
     */
    async removePasskey(id: string): Promise<StepUpResult> {
      const before = state;
      if (before.status === 'ready') set({ ...before, passkeys: before.passkeys.filter((each) => each.id !== id) });
      try {
        await api.removePasskey({ id });
        return { ok: true };
      } catch (error) {
        const failure = refused(error);
        if (before.status === 'ready' && state.status === 'ready') {
          const gone = before.passkeys.find((each) => each.id === id);
          // Back where it was, unless the server says it is gone already.
          if (gone !== undefined && !failure.ok && failure.code !== 'NOT_FOUND') {
            const at = before.passkeys.indexOf(gone);
            const passkeys = [...state.passkeys];
            passkeys.splice(Math.min(at, passkeys.length), 0, gone);
            set({ ...state, passkeys });
          }
        }
        return failure;
      }
    },
  };
}

/** The account security store. */
export type AccountSecurityStore = ReturnType<typeof createAccountSecurityStore>;
