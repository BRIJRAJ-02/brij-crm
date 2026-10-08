// Monitoring in the browser without the vendor (spec 0010, AC-163, AC-169):
// the buffer that keeps early faults, and `startMonitoring`, which does
// nothing without a DSN and sends only unexpected faults with one.
import { dataError } from '@crm/data';
import { notFound, redirect } from '@tanstack/react-router';
import type { ErrorInfo } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BUFFERED_FAULTS, createFaultBuffer, type Fault, type FaultBuffer } from './buffer.ts';
import { isExpected, type LoadSentry, startMonitoring } from './index.ts';

const errorEvent = (error: unknown) => Object.assign(new Event('error'), { error });
const rejection = (reason: unknown) => Object.assign(new Event('unhandledrejection'), { reason });

describe('the fault buffer', () => {
  it('keeps uncaught errors, unhandled rejections and reports until it drains, then forwards', () => {
    const target = new EventTarget();
    const buffer = createFaultBuffer({ target });
    const early = new Error('early');
    target.dispatchEvent(errorEvent(early));
    target.dispatchEvent(rejection('a rejected promise'));
    buffer.report({ error: 'reported', requestId: 'req-1' });

    const sent: Fault[] = [];
    buffer.drain((fault) => sent.push(fault));
    expect(sent).toEqual([
      { error: early, handled: false },
      { error: 'a rejected promise', handled: false },
      { error: 'reported', requestId: 'req-1' },
    ]);

    buffer.report({ error: 'later' });
    expect(sent.at(-1)).toEqual({ error: 'later' });
  });

  it('stops listening once drained, so the SDK alone watches the window', () => {
    const target = new EventTarget();
    const buffer = createFaultBuffer({ target });
    const sent: Fault[] = [];
    buffer.drain((fault) => sent.push(fault));
    target.dispatchEvent(errorEvent(new Error('after')));
    expect(sent).toEqual([]);
  });

  it(`keeps at most ${String(BUFFERED_FAULTS)} faults before it drains`, () => {
    const buffer = createFaultBuffer({ target: new EventTarget() });
    for (let index = 0; index < BUFFERED_FAULTS + 5; index += 1) buffer.report({ error: index });
    const sent: Fault[] = [];
    buffer.drain((fault) => sent.push(fault));
    expect(sent).toHaveLength(BUFFERED_FAULTS);
    expect(sent.at(-1)?.error).toBe(BUFFERED_FAULTS - 1);
  });
});

const CONFIG = { release: 'abc1234', environment: 'production', route: () => '/w/$slug' };
const info = (componentStack: string) => ({ componentStack }) as ErrorInfo;

/** A Sentry chunk that only records what it was started with. */
function fakeChunk() {
  const started: { config: unknown; buffered: FaultBuffer }[] = [];
  const load: LoadSentry = () =>
    Promise.resolve({
      startSentry: (config, buffered) => {
        started.push({ config, buffered });
      },
    });
  return { started, load: vi.fn(load) };
}

describe('startMonitoring', () => {
  it('without a DSN, loads nothing, listens to nothing and leaves React its defaults', () => {
    const target = new EventTarget();
    const listen = vi.spyOn(target, 'addEventListener');
    const chunk = fakeChunk();
    for (const dsn of [undefined, '']) {
      const monitor = startMonitoring({ config: { ...CONFIG, dsn }, target, load: chunk.load });
      expect(monitor.rootOptions).toEqual({});
      expect(() => {
        monitor.report({ error: new Error('nobody hears this') });
      }).not.toThrow();
    }
    expect(chunk.load).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it('with a DSN, loads the chunk once without waiting for it, and starts it with the build’s release', async () => {
    const chunk = fakeChunk();
    startMonitoring({
      config: { ...CONFIG, dsn: 'https://k@o1.ingest.de.sentry.io/2' },
      target: new EventTarget(),
      load: chunk.load,
    });
    expect(chunk.load).toHaveBeenCalledTimes(1);
    expect(chunk.started).toHaveLength(0);
    await vi.waitFor(() => {
      expect(chunk.started).toHaveLength(1);
    });
    expect(chunk.started[0]?.config).toMatchObject({ release: 'abc1234', environment: 'production' });
  });

  it("drops what isn't a fault: a DataError, and the router's not found and redirect", async () => {
    const chunk = fakeChunk();
    const monitor = startMonitoring({
      config: { ...CONFIG, dsn: 'https://k@o1.ingest.de.sentry.io/2' },
      target: new EventTarget(),
      load: chunk.load,
      logError: () => undefined,
    });
    monitor.report({ error: dataError('NOT_FOUND', 'There is no workspace at this address.') });
    monitor.rootOptions.onCaughtError?.(notFound(), info('at Route'));
    monitor.rootOptions.onCaughtError?.(redirect({ to: '/sign-in' }), info('at Route'));
    monitor.report({ error: new Error('a real fault'), requestId: 'req-2' });
    await vi.waitFor(() => {
      expect(chunk.started).toHaveLength(1);
    });
    const sent: Fault[] = [];
    chunk.started[0]?.buffered.drain((fault) => sent.push(fault));
    expect(sent).toEqual([{ error: new Error('a real fault'), requestId: 'req-2' }]);
  });

  it('reports what React caught or did not, with the component stack, and still logs it', async () => {
    const chunk = fakeChunk();
    const logged: unknown[] = [];
    const monitor = startMonitoring({
      config: { ...CONFIG, dsn: 'https://k@o1.ingest.de.sentry.io/2' },
      target: new EventTarget(),
      load: chunk.load,
      logError: (error) => logged.push(error),
    });
    const crash = new Error('a render that crashed');
    monitor.rootOptions.onUncaughtError?.(crash, info('\n    at Board'));
    monitor.rootOptions.onCaughtError?.(crash, info('\n    at Cell'));
    await vi.waitFor(() => {
      expect(chunk.started).toHaveLength(1);
    });
    const sent: Fault[] = [];
    chunk.started[0]?.buffered.drain((fault) => sent.push(fault));
    expect(sent).toEqual([
      { error: crash, handled: false, componentStack: '\n    at Board' },
      { error: crash, handled: true, componentStack: '\n    at Cell' },
    ]);
    expect(logged).toEqual([crash, crash]);
  });

  it('stops listening and keeps nothing when the chunk never comes', async () => {
    const target = new EventTarget();
    const stop = vi.spyOn(target, 'removeEventListener');
    startMonitoring({
      config: { ...CONFIG, dsn: 'https://k@o1.ingest.de.sentry.io/2' },
      target,
      load: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    });
    await vi.waitFor(() => {
      expect(stop).toHaveBeenCalledTimes(2);
    });
  });

  it('knows a fault from how the app works', () => {
    expect(isExpected(new Error('bug'))).toBe(false);
    expect(isExpected(dataError('INTERNAL', 'Something went wrong.'))).toBe(true);
  });
});
