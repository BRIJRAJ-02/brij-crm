// A write sent again when it never arrived (spec 0006; spec 0022, AC-540):
// only a lost connection is tried again, twice at most, after the answer's
// Retry-After or a second, with the same call (so the same ids).
import { describe, expect, it } from 'vitest';
import { delivered, OFFLINE_TRIES } from './delivered.ts';
import { dataError } from './errors.ts';

describe('delivered', () => {
  it('sends a write again with the same ids while it never arrives, then gives up', async () => {
    const sent: string[] = [];
    const waits: number[] = [];
    const wait = (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    };
    const start = () => {
      sent.push('job-1');
      return Promise.reject(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.'));
    };
    await expect(delivered(start, wait)).rejects.toMatchObject({ code: 'API_UNAVAILABLE' });
    expect(sent).toEqual(Array.from({ length: OFFLINE_TRIES + 1 }, () => 'job-1'));
    expect(waits).toEqual([1000, 1000]);
  });

  it('answers what the second try answers, after the answer’s Retry-After', async () => {
    let tries = 0;
    const waits: number[] = [];
    const answer = await delivered(
      () => {
        tries += 1;
        return tries === 1
          ? Promise.reject(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.', undefined, 3))
          : Promise.resolve('the job it made');
      },
      (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    );
    expect(answer).toBe('the job it made');
    expect(waits).toEqual([3000]);
  });

  it('never sends a refusal again', async () => {
    let tries = 0;
    await expect(
      delivered(
        () => {
          tries += 1;
          return Promise.reject(dataError('LIMIT_REACHED', 'Your workspace is already running 20 background changes.'));
        },
        () => Promise.resolve(),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    expect(tries).toBe(1);
  });
});
