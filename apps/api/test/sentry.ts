// Test helpers for monitoring (spec 0010): a fake Sentry transport that keeps
// every envelope the SDK would have sent, and readers for the error events and
// spans in them. Nothing here imports the vendor; the wrapper's `deliver` option is the
// seam.

/** One error event as Sentry receives it, the fields the tests read. */
export interface SentEvent {
  readonly message?: string;
  readonly environment?: string;
  readonly release?: string;
  /** The request's name, as `nameRequest` set it (`rpc records.query`). */
  readonly transaction?: string;
  readonly tags?: Readonly<Record<string, string>>;
  readonly user?: Readonly<Record<string, unknown>>;
  readonly exception?: { readonly values?: readonly { readonly type?: string; readonly value?: string }[] };
  readonly breadcrumbs?: readonly Readonly<Record<string, unknown>>[];
  readonly request?: Readonly<Record<string, unknown>>;
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly contexts?: { readonly trace?: { readonly trace_id?: string } };
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

/** One span as Sentry receives it (span streaming, `span.v2`), the fields the tests read. */
export interface SentSpan {
  readonly name: string;
  readonly trace_id: string;
  readonly span_id: string;
  readonly parent_span_id?: string;
  readonly is_segment: boolean;
  readonly attributes: Readonly<Record<string, { readonly value: unknown }>>;
}

/** The spans in an envelope: each `span` item's payload holds a list of them. */
export function spansIn(envelope: string): SentSpan[] {
  const lines = envelope.split('\n').filter((line) => line.trim() !== '');
  const spans: SentSpan[] = [];
  for (let index = 1; index < lines.length - 1; index += 2) {
    const header = JSON.parse(lines[index] ?? '{}') as { type?: string };
    if (header.type === 'span') spans.push(...(JSON.parse(lines[index + 1] ?? '{}') as { items: SentSpan[] }).items);
  }
  return spans;
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
    spans: (): SentSpan[] => envelopes.flatMap(spansIn),
    clear: () => {
      envelopes.length = 0;
    },
  };
}
