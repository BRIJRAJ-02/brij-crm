// The one container launcher (spec 0044): migrate first, then the api and the worker, and a non zero exit when
// either child dies, so Render restarts the container. Driven with fake children: no process is started.
import { describe, expect, it } from 'vitest';
import { type Child, launch, MIGRATE_ARGS, PROCESSES, STOP_GRACE_MS } from './launch.ts';

interface FakeChild extends Child {
  readonly args: readonly string[];
  readonly signals: NodeJS.Signals[];
  readonly end: (code: number | null) => void;
}

function harness() {
  const children: FakeChild[] = [];
  const listeners = new Map<NodeJS.Signals, () => void>();
  const timers: { ms: number; task: () => void }[] = [];
  const exits: number[] = [];
  const errors: string[] = [];
  launch({
    run: (args) => {
      const signals: NodeJS.Signals[] = [];
      const exitListeners: ((code: number | null) => void)[] = [];
      const child: FakeChild = {
        args,
        signals,
        kill: (signal) => signals.push(signal),
        onExit: (listener) => exitListeners.push(listener),
        end: (code) => {
          for (const listener of exitListeners) listener(code);
        },
      };
      children.push(child);
      return child;
    },
    onSignal: (signal, listener) => listeners.set(signal, listener),
    exit: (code) => exits.push(code),
    later: (ms, task) => timers.push({ ms, task }),
    log: { info: () => undefined, error: (message) => errors.push(message) },
  });
  const signal = (name: NodeJS.Signals) => listeners.get(name)?.();
  return { children, signal, timers, exits, errors };
}

describe('the launcher', () => {
  it('runs the migration alone first, then the api and the worker with the instrument and their heap caps', () => {
    const { children } = harness();
    expect(children.map((child) => child.args)).toEqual([MIGRATE_ARGS]);
    children[0]?.end(0);
    expect(children.map((child) => child.args)).toEqual([MIGRATE_ARGS, PROCESSES.api, PROCESSES.worker]);
    for (const args of [PROCESSES.api, PROCESSES.worker]) {
      expect(args).toContain('./apps/api/src/monitoring/instrument.ts');
      expect(args.some((arg) => arg.startsWith('--max-old-space-size='))).toBe(true);
    }
  });

  it('starts nothing and exits 1 when the migration fails', () => {
    const { children, exits, errors } = harness();
    children[0]?.end(1);
    expect(children).toHaveLength(1);
    expect(exits).toEqual([1]);
    expect(errors).toEqual(['launch.migrate.failed']);
  });

  it('counts a migration ended by a signal as a failure', () => {
    const { children, exits } = harness();
    children[0]?.end(null);
    expect(children).toHaveLength(1);
    expect(exits).toEqual([1]);
  });

  it.each([1, 2])('stops the other and exits 1 when child %i dies on its own, even with code 0', (index) => {
    const { children, exits, errors } = harness();
    children[0]?.end(0);
    const [api, worker] = [children[1], children[2]];
    const died = index === 1 ? api : worker;
    const other = index === 1 ? worker : api;
    died?.end(0);
    expect(errors).toEqual(['launch.child.died']);
    expect(other?.signals).toEqual(['SIGTERM']);
    expect(exits).toEqual([]);
    other?.end(0);
    expect(exits).toEqual([1]);
  });

  it('forwards SIGTERM to both children and exits 0 once both stop cleanly', () => {
    const { children, signal, exits } = harness();
    children[0]?.end(0);
    signal('SIGTERM');
    expect(children[1]?.signals).toEqual(['SIGTERM']);
    expect(children[2]?.signals).toEqual(['SIGTERM']);
    children[1]?.end(0);
    expect(exits).toEqual([]);
    children[2]?.end(0);
    expect(exits).toEqual([0]);
  });

  it('exits 1 when a child fails to stop cleanly after a signal', () => {
    const { children, signal, exits } = harness();
    children[0]?.end(0);
    signal('SIGINT');
    children[1]?.end(0);
    children[2]?.end(137);
    expect(exits).toEqual([1]);
  });

  it('exits 1 after the grace period when a child ignores SIGTERM', () => {
    const { children, signal, timers, exits, errors } = harness();
    children[0]?.end(0);
    signal('SIGTERM');
    children[1]?.end(0);
    expect(timers.map((timer) => timer.ms)).toEqual([STOP_GRACE_MS]);
    timers[0]?.task();
    expect(exits).toEqual([1]);
    expect(errors).toEqual(['launch.stop.timeout']);
    // A late exit after that changes nothing.
    children[2]?.end(0);
    expect(exits).toEqual([1]);
  });

  it('stops during the migration without starting the children', () => {
    const { children, signal, exits } = harness();
    signal('SIGTERM');
    expect(children[0]?.signals).toEqual(['SIGTERM']);
    children[0]?.end(null);
    expect(children).toHaveLength(1);
    expect(exits).toEqual([0]);
  });
});
