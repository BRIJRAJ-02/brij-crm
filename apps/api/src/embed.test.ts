// What an embedded session may call (spec 0070, AC-7033): setting up a person's own Timefix login is never among them
// (AC-7023; coordinator, 10 Nov 2026), so an app can't mint logins from inside its frame; the person's own read of
// whom to ask is.
import { describe, expect, it } from 'vitest';
import { embedReachOf } from './embed.ts';

describe('the frame’s procedures', () => {
  it('leaves out setting up and cancelling a Timefix login, and keeps the person’s own read', () => {
    expect(embedReachOf('teamPages.inviteLogin')).toBeUndefined();
    expect(embedReachOf('teamPages.cancelLoginInvite')).toBeUndefined();
    expect(embedReachOf('teamPages.myLogin')).toBe('link_pages');
    expect(embedReachOf('teamPages.list')).toBe('link_pages');
  });
});
