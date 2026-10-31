import { describe, expect, it, vi } from 'vitest';
import type { Automation } from '@crm/contracts';
import type { Notice } from '../notice.ts';
import { createAutomationsStore, type AutomationsApi } from './store.ts';

const ID = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const automation = (n: number, patch: Partial<Automation> = {}): Automation => ({
  id: ID(n),
  trigger: { kind: 'task_due' },
  actions: [{ kind: 'notify', who: { kind: 'owner' } }],
  enabled: true,
  failures: 0,
  runAsMemberId: ID(99),
  createdAt: `2026-10-0${String(n)}T00:00:00.000Z`,
  updatedAt: `2026-10-0${String(n)}T00:00:00.000Z`,
  ...patch,
});

function make(initial: readonly Automation[], overrides: Partial<AutomationsApi> = {}) {
  const notices: Notice[] = [];
  let ids = 100;
  const api: AutomationsApi = {
    list: () => Promise.resolve({ automations: initial, max: 50 }),
    runs: () => Promise.resolve({ runs: [] }),
    create: (input) => Promise.resolve(automation(Number(input.id.slice(-3)))),
    update: () => Promise.reject(new Error('unused')),
    setEnabled: (input) => Promise.resolve(automation(1, { id: input.automationId, enabled: input.enabled })),
    remove: () => Promise.resolve({}),
    restore: (input) => Promise.resolve(automation(1, { id: input.automationId })),
    ...overrides,
  };
  const store = createAutomationsStore({ api, mintId: () => ID((ids += 1)), notify: (n) => notices.push(n) });
  return { store, notices, held: store.held('acme') };
}

const automations = (held: ReturnType<typeof make>['held']) => {
  const state = held.getSnapshot();
  return state.status === 'ready' ? state.automations.map((each) => [each.id, each.enabled]) : state.status;
};

describe('the held automations', () => {
  it('reads the list and the log, then shows them', async () => {
    const { held } = make([automation(1), automation(2)]);
    expect(held.getSnapshot().status).toBe('loading');
    await held.ready();
    expect(automations(held)).toEqual([
      [ID(1), true],
      [ID(2), true],
    ]);
  });

  it('shows a switch at once and puts it back with a toast when refused', async () => {
    let refuse = false;
    const { held, notices } = make([automation(1)], {
      setEnabled: () => (refuse ? Promise.reject(new Error('no')) : Promise.resolve(automation(1, { enabled: false }))),
    });
    await held.ready();
    await held.setEnabled(ID(1), false);
    expect(automations(held)).toEqual([[ID(1), false]]);
    refuse = true;
    const pending = held.setEnabled(ID(1), true);
    expect(automations(held)).toEqual([[ID(1), true]]);
    expect(await pending).toBe(false);
    expect(automations(held)).toEqual([[ID(1), false]]);
    expect(notices.at(-1)?.tone).toBe('danger');
  });

  it('deletes at once, and Undo brings the same one back in its place', async () => {
    const restore = vi.fn((input: { automationId: string }) =>
      Promise.resolve(automation(1, { id: input.automationId })),
    );
    const { held, notices } = make([automation(1), automation(2)], { restore });
    await held.ready();
    expect(await held.remove(ID(1))).toBe(true);
    expect(automations(held)).toEqual([[ID(2), true]]);
    const undo = notices.at(-1)?.action;
    expect(undo?.label).toBe('Undo');
    undo?.onAction();
    await vi.waitFor(() =>
      expect(automations(held)).toEqual([
        [ID(1), true],
        [ID(2), true],
      ]),
    );
    expect(restore).toHaveBeenCalledWith({ workspace: 'acme', automationId: ID(1) });
  });

  it('puts a refused delete back', async () => {
    const { held } = make([automation(1)], { remove: () => Promise.reject(new Error('no')) });
    await held.ready();
    expect(await held.remove(ID(1))).toBe(false);
    expect(automations(held)).toEqual([[ID(1), true]]);
  });

  it('reads again on a live event, once for a burst', async () => {
    vi.useFakeTimers();
    const list = vi.fn(() => Promise.resolve({ automations: [automation(1)], max: 50 }));
    const { store, held } = make([], { list });
    const stop = held.retain();
    await vi.advanceTimersByTimeAsync(0);
    list.mockClear();
    store.changed('acme');
    store.changed('acme');
    store.changed('acme');
    await vi.advanceTimersByTimeAsync(400);
    expect(list).toHaveBeenCalledTimes(1);
    stop();
    vi.useRealTimers();
  });
});
