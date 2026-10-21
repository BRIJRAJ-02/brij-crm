// Schedules' words (spec 0035, AC-967): the pages a delete moves, named as a sentence says them.
import { describe, expect, it } from 'vitest';
import { deleteSentence, listOfNames, scheduleChoices } from './schedules.ts';

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
      'Intro call will use Working hours, your default. This can’t be undone.',
    );
    expect(deleteSentence(['Intro call'], 'Working hours', false)).toBe(
      'Intro call will use Working hours, their default. This can’t be undone.',
    );
    expect(deleteSentence(['Intro call', 'Demo'], 'Working hours')).toBe(
      'Intro call and Demo will use Working hours, your default. This can’t be undone.',
    );
  });
});

describe('scheduleChoices', () => {
  const schedules = [
    { id: null, name: 'Working hours', isDefault: true },
    { id: 'evenings', name: 'Evenings', isDefault: false },
  ];

  it('names the default by its schedule, with a Default badge, then the others', () => {
    expect(scheduleChoices(schedules, null)).toEqual([
      { id: 'default', label: 'Working hours', badge: 'Default' },
      { id: 'evenings', label: 'Evenings' },
    ]);
  });

  it('lists a saved default again only for a page pinned to it', () => {
    const saved = [
      { id: 'work', name: 'Work', isDefault: true },
      { id: 'evenings', name: 'Evenings', isDefault: false },
    ];
    expect(scheduleChoices(saved, null).map((each) => each.id)).toEqual(['default', 'evenings']);
    expect(scheduleChoices(saved, 'work').map((each) => each.id)).toEqual(['default', 'work', 'evenings']);
    expect(scheduleChoices(saved, 'work')[1]?.description).toBe('Stays on Work if your default changes');
  });

  it('says Default schedule before the schedules are read', () => {
    expect(scheduleChoices([], null)).toEqual([{ id: 'default', label: 'Default schedule' }]);
  });
});
