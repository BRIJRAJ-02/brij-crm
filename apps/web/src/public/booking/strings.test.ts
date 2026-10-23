// The guest page's words about a booking say only what Timefix does (QA Q77, Q79): a video call with no link made
// names who sends it, and a move or cancel never claims calendars the host may not have connected.
import { describe, expect, it } from 'vitest';
import { changeStrings } from './change-strings.ts';
import { strings } from './strings.ts';

describe('the guest page’s promises', () => {
  it('says the host sends a video call’s link, never that one comes with an invitation', () => {
    expect(strings.video('Pia Host')).toBe('Video call. Pia Host will send you the link.');
  });

  it('says a move and a cancel were told to the host, without claiming anyone’s calendar', () => {
    for (const words of [changeStrings.movedText('Pia Host'), changeStrings.cancelledText('Pia Host')]) {
      expect(words).toMatch(/^Pia Host has been told/);
      expect(words).not.toMatch(/calendar/i);
    }
  });
});
