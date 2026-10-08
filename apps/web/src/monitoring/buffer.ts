// Holds the browser's faults until Sentry has loaded (spec 0010, AC-169). The
// SDK comes in its own chunk, started at boot and never awaited, so an error
// in the first moments would otherwise be lost: the buffer keeps up to `max`
// of them (uncaught errors, unhandled rejections, and what the app reports),
// then hands them over once and steps aside. No vendor here.

/** One fault for monitoring: what was thrown, and what is known about where. */
export interface Fault {
  readonly error: unknown;
  /** The failed call's request id (`x-request-id`), when an answer carried one. */
  readonly requestId?: string;
  /** The procedure or sign in step that failed. */
  readonly procedure?: string;
  /** React's component stack, for a render that crashed. */
  readonly componentStack?: string;
  /** Whether something caught it (an error boundary) or nothing did. */
  readonly handled?: boolean;
}

/** Where faults go once monitoring is ready. */
export type FaultSink = (fault: Fault) => void;

/** The buffer: report into it now, and drain it into Sentry once. */
export interface FaultBuffer {
  /** Keeps a fault until `drain`, then forwards it straight to the sink. */
  readonly report: FaultSink;
  /** Hands over what was kept, stops listening to the window, and forwards everything after. */
  readonly drain: (sink: FaultSink) => void;
}

/** What the buffer listens to: the window, or a stand in for it in tests. */
export interface FaultTarget {
  addEventListener(type: 'error' | 'unhandledrejection', listener: (event: Event) => void): void;
  removeEventListener(type: 'error' | 'unhandledrejection', listener: (event: Event) => void): void;
}

/** The faults the buffer keeps before Sentry starts; any more are dropped. */
export const BUFFERED_FAULTS = 20;

/** What an `error` or `unhandledrejection` event carries. */
function thrown(event: Event): unknown {
  if ('reason' in event) return event.reason;
  if ('error' in event && event.error !== undefined && event.error !== null) return event.error;
  return 'message' in event ? event.message : event.type;
}

/**
 * Starts listening for uncaught errors and unhandled rejections on `target`,
 * keeping up to `max`; one `ignore` says is no fault (a refusal, being
 * offline) is never kept.
 */
export function createFaultBuffer({
  target,
  max = BUFFERED_FAULTS,
  ignore = () => false,
}: {
  readonly target: FaultTarget;
  readonly max?: number;
  readonly ignore?: (error: unknown) => boolean;
}): FaultBuffer {
  const kept: Fault[] = [];
  let sink: FaultSink | undefined;

  const keep: FaultSink = (fault) => {
    if (sink !== undefined) {
      sink(fault);
      return;
    }
    if (kept.length < max) kept.push(fault);
  };
  const onError = (event: Event) => {
    const error = thrown(event);
    if (!ignore(error)) keep({ error, handled: false });
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onError);

  return {
    report: keep,
    drain: (next) => {
      if (sink !== undefined) return;
      // From here on Sentry's own handlers see the window.
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onError);
      sink = next;
      for (const fault of kept.splice(0)) next(fault);
    },
  };
}
