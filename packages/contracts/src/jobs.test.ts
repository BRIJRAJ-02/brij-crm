import { describe, expect, it } from 'vitest';
import { ERROR_MAP } from './errors.ts';
import {
  JobsListInput,
  jobLabel,
  MAX_TEST_JOB_ITEMS,
  QueuePayload,
  StartTestJobInput,
  UNKNOWN_JOB_LABEL,
} from './jobs.ts';

const id = '0192f4a1-7c00-7000-8000-000000000001';

describe('the queue payload (AC-115, AC-122)', () => {
  it('holds a workspace id and a job id, and nothing more', () => {
    expect(QueuePayload.parse({ workspaceId: id, jobId: id })).toEqual({ workspaceId: id, jobId: id });
    expect(QueuePayload.safeParse({ workspaceId: id, jobId: id, params: {} }).success).toBe(false);
    expect(QueuePayload.safeParse({ workspaceId: 'x', jobId: id }).success).toBe(false);
  });
});

describe('the jobs procedures', () => {
  it('pages at most 50 jobs, mine by default', () => {
    expect(JobsListInput.parse({ workspace: 'acme' }).scope).toBe('mine');
    expect(JobsListInput.safeParse({ workspace: 'acme', limit: 51 }).success).toBe(false);
  });

  it('bounds a test job: 1 to 200,000 items, batches up to 5,000, waits up to 2 seconds, a v7 id', () => {
    const base = { workspace: 'acme', id, items: 10, mutationId: id };
    expect(StartTestJobInput.parse(base).batchMillis).toBe(0);
    for (const bad of [
      { items: 0 },
      { items: MAX_TEST_JOB_ITEMS + 1 },
      { batchSize: 5_001 },
      { batchMillis: 2_001 },
      { id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
    ]) {
      expect(StartTestJobInput.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('labels a known kind, and any other one plainly', () => {
    expect(jobLabel('dev.simulate')).toBe('Test job');
    expect(jobLabel('something.newer')).toBe(UNKNOWN_JOB_LABEL);
    expect(jobLabel('constructor')).toBe(UNKNOWN_JOB_LABEL);
  });

  it('answers the job refusals with their statuses', () => {
    expect(ERROR_MAP.JOB_FINISHED.status).toBe(409);
    expect(ERROR_MAP.JOB_NOT_CANCELLABLE.status).toBe(409);
    expect(ERROR_MAP.JOB_NOT_READY.status).toBe(409);
    expect(ERROR_MAP.JOB_EXPIRED.status).toBe(409);
    expect(ERROR_MAP.JOB_TOO_LARGE.status).toBe(422);
  });
});
