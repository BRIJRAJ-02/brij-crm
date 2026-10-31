// The computed preview's waiting and cancelling (spec 0015): one send 400 ms after the last ask, a newer ask
// cancelling the older request, the last answer kept while a newer one is out, and Try again.
import { describe, expect, it } from 'vitest';
import type { ComputedPreview } from '@crm/contracts';
import { createPreview, PREVIEW_DEBOUNCE_MS } from './preview.ts';

/** A clock the test runs by hand. */
function manualClock() {
  const waiting: { ms: number; run: () => void; cancelled: boolean }[] = [];
  return {
    wait: (ms: number, run: () => void) => {
      const entry = { ms, run, cancelled: false };
      waiting.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    fire: () => {
      for (const entry of waiting.splice(0)) if (!entry.cancelled) entry.run();
    },
  };
}

const ANSWER: ComputedPreview = { resultType: { type: 'number', isMulti: false }, samples: [] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createPreview', () => {
  it('sends once, after the last ask, and keeps the last answer while a newer one is out', async () => {
    const clock = manualClock();
    const sent: AbortSignal[] = [];
    const answers: ((value: ComputedPreview) => void)[] = [];
    const preview = createPreview({
      wait: clock.wait,
      send: (_definition, signal) => {
        sent.push(signal);
        return new Promise((resolve) => answers.push(resolve));
      },
    });
    preview.ask({ kind: 'formula', source: '1' });
    preview.ask({ kind: 'formula', source: '1 + 1' });
    clock.fire();
    expect(sent).toHaveLength(1);
    expect(preview.state().status).toBe('loading');
    answers[0]?.(ANSWER);
    await settle();
    expect(preview.state()).toEqual({ status: 'ready', result: ANSWER });

    preview.ask({ kind: 'formula', source: '2' });
    clock.fire();
    expect(preview.state()).toEqual({ status: 'loading', result: ANSWER });
    preview.ask({ kind: 'formula', source: '3' });
    clock.fire();
    expect(sent[1]?.aborted).toBe(true);
    expect(PREVIEW_DEBOUNCE_MS).toBe(400);
  });

  it('fails with the last answer kept, and Try again sends again', async () => {
    const clock = manualClock();
    let calls = 0;
    const preview = createPreview({
      wait: clock.wait,
      send: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('down')) : Promise.resolve(ANSWER);
      },
    });
    preview.ask({ kind: 'formula', source: '1' });
    clock.fire();
    await settle();
    expect(preview.state().status).toBe('error');
    preview.retry();
    await settle();
    expect(preview.state()).toEqual({ status: 'ready', result: ANSWER });
  });

  it('goes idle when the definition is incomplete', () => {
    const preview = createPreview({ wait: manualClock().wait, send: () => Promise.resolve(ANSWER) });
    preview.ask(undefined);
    expect(preview.state().status).toBe('idle');
  });
});
