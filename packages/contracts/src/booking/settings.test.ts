import { describe, expect, it } from 'vitest';
import { BookingPageSettingsWrite } from './pages.ts';
import { BookingDuration } from './settings.ts';

describe('booking lengths', () => {
  it('takes 5 to 480 minutes in steps of 5', () => {
    for (const minutes of [5, 25, 120, 480]) expect(BookingDuration.safeParse(minutes).success).toBe(true);
    for (const minutes of [0, 22, 485, 30.5]) expect(BookingDuration.safeParse(minutes).success).toBe(false);
  });

  it('refuses a fifth length with a plain message, since the public page shows four', () => {
    expect(BookingPageSettingsWrite.safeParse({ durations: [15, 25, 30, 120] }).success).toBe(true);
    const five = BookingPageSettingsWrite.safeParse({ durations: [15, 25, 30, 60, 120] });
    expect(five.success).toBe(false);
    expect(five.error?.issues[0]?.message).toBe('A page offers at most 4 lengths.');
  });
});
