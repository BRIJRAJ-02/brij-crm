// A computed attribute's preview (spec 0015, `data.computed.preview`): the
// attribute dialog asks with every change, and the layer waits 400 ms after
// the last before it sends, a newer ask cancelling the older request through
// its AbortController. The last answer stays on screen while a newer one is
// out. No Zod, no timers left behind: `dispose` ends everything.
import type { ComputedDefinitionInput, ComputedPreview } from '@crm/contracts';

/** How long the preview waits after the last change before it asks. */
export const PREVIEW_DEBOUNCE_MS = 400;

/** Where a preview stands: nothing asked yet, out, answered, or failed (with the last answer kept). */
export interface PreviewState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly result?: ComputedPreview;
}

/** One dialog's preview: ask with each change, read and watch its state, retry a failure, let go. */
export interface PreviewSource {
  ask(definition: ComputedDefinitionInput | undefined): void;
  retry(): void;
  state(): PreviewState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** What the preview needs of its environment: the call, and a clock to wait with (tests pass their own). */
export interface PreviewDeps {
  readonly send: (definition: ComputedDefinitionInput, signal: AbortSignal) => Promise<ComputedPreview>;
  readonly wait?: (ms: number, run: () => void) => () => void;
}

const realWait = (ms: number, run: () => void) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/** Makes one dialog's preview. */
export function createPreview(deps: PreviewDeps): PreviewSource {
  const wait = deps.wait ?? realWait;
  const listeners = new Set<() => void>();
  let state: PreviewState = { status: 'idle' };
  let asked: ComputedDefinitionInput | undefined;
  let cancelWait: (() => void) | undefined;
  let inFlight: AbortController | undefined;
  let disposed = false;

  const set = (next: PreviewState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const send = (definition: ComputedDefinitionInput) => {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    set({ status: 'loading', ...(state.result === undefined ? {} : { result: state.result }) });
    deps.send(definition, controller.signal).then(
      (result) => {
        if (controller.signal.aborted || disposed) return;
        inFlight = undefined;
        set({ status: 'ready', result });
      },
      () => {
        if (controller.signal.aborted || disposed) return;
        inFlight = undefined;
        set({ status: 'error', ...(state.result === undefined ? {} : { result: state.result }) });
      },
    );
  };
  const schedule = () => {
    cancelWait?.();
    const definition = asked;
    if (definition === undefined) {
      inFlight?.abort();
      set({ status: 'idle' });
      return;
    }
    cancelWait = wait(PREVIEW_DEBOUNCE_MS, () => {
      cancelWait = undefined;
      if (!disposed) send(definition);
    });
  };
  return {
    ask(definition) {
      if (disposed) return;
      if (definition !== undefined && JSON.stringify(definition) === JSON.stringify(asked)) return;
      asked = definition;
      schedule();
    },
    retry() {
      if (!disposed && asked !== undefined) send(asked);
    },
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      cancelWait?.();
      inFlight?.abort();
      listeners.clear();
    },
  };
}
