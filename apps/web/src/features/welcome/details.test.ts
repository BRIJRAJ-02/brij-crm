// First run's About you answers (spec 0036): "All of it" as the three areas, and what is sent or kept.
import { describe, expect, it } from 'vitest';
import { answersFrom, answersToSend, areasFromChips, chipsFromAreas } from './details.ts';

describe('the area chips', () => {
  it('hold every area with All of it, and let go of them all with it', () => {
    expect(areasFromChips([], ['all'])).toEqual(['crm', 'booking', 'forms']);
    expect(chipsFromAreas(['crm', 'booking', 'forms'])).toEqual(['crm', 'booking', 'forms', 'all']);
    expect(areasFromChips(['crm', 'booking', 'forms'], ['crm', 'booking', 'forms'])).toEqual([]);
  });

  it('let go of All of it when one area is let go, and hold it once all three are picked', () => {
    expect(areasFromChips(['crm', 'booking', 'forms'], ['booking', 'forms', 'all'])).toEqual(['booking', 'forms']);
    expect(chipsFromAreas(['booking', 'forms'])).toEqual(['booking', 'forms']);
    expect(areasFromChips(['crm', 'booking'], ['crm', 'booking', 'forms'])).toEqual(['crm', 'booking', 'forms']);
  });

  it('keep the offered order', () => {
    expect(areasFromChips([], ['forms', 'crm'])).toEqual(['crm', 'forms']);
  });
});

describe('the answers', () => {
  it('send only what was answered, and nothing when nothing was', () => {
    expect(answersToSend({})).toBeUndefined();
    expect(answersToSend({ areas: [] })).toBeUndefined();
    expect(answersToSend({ role: 'sales', areas: [] })).toEqual({ role: 'sales' });
  });

  it('read back from a draft keep only offered values', () => {
    expect(answersFrom({ role: 'astronaut', teamSize: '2-10', areas: ['forms', 'evil', 'crm'] })).toEqual({
      teamSize: '2-10',
      areas: ['crm', 'forms'],
    });
    expect(answersFrom('nope')).toBeUndefined();
    expect(answersFrom({})).toBeUndefined();
  });
});
