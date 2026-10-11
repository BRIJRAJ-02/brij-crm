import { describe, expect, it } from 'vitest';
import { jobEnding, jobFinishedToast } from './toast.ts';

describe('the finish toast (AC-119)', () => {
  it('says how a job ended', () => {
    expect(jobEnding({ status: 'succeeded', refused: 0 })).toBe('Done');
    expect(jobEnding({ status: 'succeeded', refused: 6 })).toBe('Done, 6 refused');
    expect(jobEnding({ status: 'failed', refused: 0 })).toBe('Failed');
    expect(jobEnding({ status: 'cancelled', refused: 2 })).toBe('Cancelled');
  });

  it('names the job, links to the page, and shows a failure as an error', () => {
    let opened = 0;
    const toast = jobFinishedToast({ label: 'Test job', status: 'failed', refused: 0 }, () => (opened += 1));
    expect(toast).toMatchObject({ tone: 'danger', message: 'Test job: Failed', action: { label: 'View' } });
    toast.action?.onAction();
    expect(opened).toBe(1);
    expect(jobFinishedToast({ label: 'Test job', status: 'succeeded', refused: 0 }, () => undefined).tone).toBe(
      'success',
    );
  });
});
