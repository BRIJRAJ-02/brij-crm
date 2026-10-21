// Schedules' words (spec 0035, AC-967): the pages a delete moves, named as a sentence says them.
import { describe, expect, it } from 'vitest';
import { deleteSentence, listOfNames } from './schedules.ts';

describe('listOfNames', () => {
  it('joins one, two and three names as a sentence says them, and counts the rest', () => {
    expect(listOfNames([])).toBe('');
    expect(listOfNames(['Intro call'])).toBe('Intro call');
    expect(listOfNames(['Intro call', 'Demo'])).toBe('Intro call and Demo');
    expect(listOfNames(['Intro call', 'Demo', 'Sales'])).toBe('Intro call, Demo and Sales');
    expect(listOfNames(['Intro call', 'Demo', 'Sales', 'Partners', 'Support'])).toBe(
      'Intro call, Demo, Sales and 2 more',
    );
  });
});

describe('deleteSentence', () => {
  it('says what happens to the pages a delete moves, and that it can’t be undone, in one sentence', () => {
    expect(deleteSentence([], 'Working hours')).toBe('No booking pages use it, and this can’t be undone.');
    expect(deleteSentence(['Intro call'], 'Working hours')).toBe(
      'Intro call, the one booking page that uses it, will book by Working hours, your default, and this can’t be undone.',
    );
    expect(deleteSentence(['Intro call', 'Demo'], 'Working hours')).toBe(
      'Intro call and Demo, the 2 booking pages that use it, will book by Working hours, your default, and this can’t be undone.',
    );
  });
});
