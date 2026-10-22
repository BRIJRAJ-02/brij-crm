import { describe, expect, it } from 'vitest';
import { browserZone, memberZone } from './zone.ts';

type Snapshot = ReturnType<ReturnType<Parameters<typeof memberZone>[0]['preferences']['of']>['getSnapshot']>;

const dataWith = (snapshot: Snapshot): Parameters<typeof memberZone>[0] =>
  ({
    preferences: {
      of: () => ({ getSnapshot: () => snapshot, subscribe: () => () => undefined, retain: () => () => undefined }),
    },
  }) as unknown as Parameters<typeof memberZone>[0];

describe('memberZone', () => {
  it('is the member’s Preferences zone once read', () => {
    const data = dataWith({
      status: 'ready',
      preferences: { timeZone: 'Asia/Kolkata', dateFormat: 'auto', weekStart: 'auto', landing: { kind: 'auto' } },
    } as unknown as Snapshot);
    expect(memberZone(data, 'acme')).toBe('Asia/Kolkata');
  });

  it('is the browser’s while the preferences load, or when the member chose Automatic', () => {
    expect(memberZone(dataWith({ status: 'loading' }), 'acme')).toBe(browserZone());
  });
});
