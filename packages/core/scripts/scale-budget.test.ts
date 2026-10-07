import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/index.ts';
import { SCALE_BUDGET } from './scale-budget.ts';

describe('SCALE_BUDGET', () => {
  it('holds the targets spec 0011 names', () => {
    expect(SCALE_BUDGET.online).toEqual({ gate: 100, room: 1_000 });
    expect(SCALE_BUDGET.p95Ms).toEqual({
      read: 300,
      open: 200,
      edit: 250,
      create: 300,
      liveDelivery: 1_000,
      poolWait: 50,
      relayLag: 250,
    });
    expect(SCALE_BUDGET.postgresCpuP95Share).toBe(0.7);
    expect(SCALE_BUDGET.unexpectedErrorShare).toBe(0.001);
    expect(SCALE_BUDGET.load.actionsPerUserPerSecond).toBe(0.2);
  });

  it('has a mix that adds up to every action', () => {
    const total = Object.values(SCALE_BUDGET.load.mix).reduce((sum, share) => sum + share, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('targets the same record count the engine allows', () => {
    expect(SCALE_BUDGET.recordsPerWorkspace).toBe(LIMITS.liveRecords);
  });
});
