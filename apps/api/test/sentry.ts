// Test helpers for monitoring (spec 0010): a fake Sentry transport that keeps
// every envelope the SDK would have sent, and a reader for the error events in
// them. Nothing here imports the vendor; the wrapper's `deliver` option is the
// seam.

/** One error event as Sentry receives it, the fields the tests read. */
export interface SentEvent {
  readonly message?: string;
  readonly environment?: string;
  readonly release?: string;
  readonly tags?: Readonly<Record<string, string>>;
  readonly user?: Readonly<Record<string, unknown>>;
  readonly exception?: { readonly values?: readonly { readonly type?: string; readonly value?: string }[] };
  readonly breadcrumbs?: readonly Readonly<Record<string, unknown>>[];
  readonly request?: Readonly<Record<string, unknown>>;
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** The error events in an envelope: each item header is a JSON line, and an `event` item's payload follows it. */
export function eventsIn(envelope: string): SentEvent[] {
  const lines = envelope.split('\n').filter((line) => line.trim() !== '');
  const events: SentEvent[] = [];
  // The first line is the envelope's own header.
  for (let index = 1; index < lines.length - 1; index += 2) {
    const header = JSON.parse(lines[index] ?? '{}') as { type?: string };
    if (header.type === 'event') events.push(JSON.parse(lines[index + 1] ?? '{}') as SentEvent);
  }
  return events;
}

/** A transport that keeps what it is handed: every envelope as text, and the error events in them. */
export function memoryTransport() {
  const envelopes: string[] = [];
  return {
    envelopes,
    deliver: (envelope: string): Promise<void> => {
      envelopes.push(envelope);
      return Promise.resolve();
    },
    events: (): SentEvent[] => envelopes.flatMap(eventsIn),
    clear: () => {
      envelopes.length = 0;
    },
  };
}
