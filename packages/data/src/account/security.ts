// Account › Sign in and devices' state (spec 0033, milestone 2): two factor on or off,
// backup codes left, and whether this session is fresh for a sensitive
// change. One held value, read when a screen first holds it and again after
// each change. A step up (AC-896) proves who the person is again and makes
// the session fresh for 10 minutes; the screens ask for it inline, in the
// change's own dialog, and then carry on.
import type { AccountSecurity, SessionFreshness, StepUpMethod } from '@crm/contracts';
import { refusalSummary, toDataError, type DataError } from '../errors.ts';

/** The calls the store makes. */
export interface AccountSecurityApi {
  readonly get: () => Promise<AccountSecurity>;
  readonly startStepUp: () => Promise<unknown>;
  readonly verifyStepUp: (input: { readonly method: StepUpMethod; readonly code: string }) => Promise<SessionFreshness>;
}

/** Account › Sign in and devices' state: loading, failed, or as the server last said. */
export type AccountSecurityState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | ({ readonly status: 'ready' } & AccountSecurity);

/** How a step up went: done, or refused with a code and a sentence for the dialog to show. */
export type StepUpResult =
  { readonly ok: true } | { readonly ok: false; readonly code: DataError['code']; readonly message: string };

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
  };
}

/** The account security store. */
export type AccountSecurityStore = ReturnType<typeof createAccountSecurityStore>;
