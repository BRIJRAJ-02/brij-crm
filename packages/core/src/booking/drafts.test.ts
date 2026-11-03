// A page's unpublished changes as sentences (spec 0068, AC-6811), per kind, and the draft's own arithmetic: what is
// left once a setting goes back to what guests see, and a version made a draft.
import { describe, expect, it } from 'vitest';
import {
  changedOnly,
  diffPage,
  draftFromSnapshot,
  draftOf,
  publishedSnapshot,
  type PublishedBooking,
} from './drafts.ts';

const PUBLISHED: PublishedBooking = {
  title: 'Intro',
  description: '',
  durations: [30],
  location: { type: 'video' },
  bufferBefore: 0,
  bufferAfter: 0,
  minNoticeMinutes: 0,
  windowDays: 60,
  dailyLimit: null,
  slotStep: null,
  scheduleId: null,
  defaultView: 'month',
  showSocials: true,
  questions: [],
};

describe('diffPage (booking)', () => {
  it('says each change in a plain sentence, in the editor’s order', () => {
    expect(
      diffPage('booking', PUBLISHED, {
        durations: [45, 90],
        title: 'Intro call',
        location: { type: 'phone' },
        dailyLimit: 4,
        minNoticeMinutes: 120,
        showSocials: false,
        description: 'A short chat.',
      }),
    ).toEqual([
      'Title “Intro” → “Intro call”',
      'Description changed',
      'Length 30 min → 45 min, 1 h 30 min',
      'Location Video call → Phone',
      'Notice 0 min → 2 h',
      'Daily limit set to 4',
      'Social links hidden',
    ]);
  });

  it('says nothing of a setting held at what guests see, and cuts a long title', () => {
    expect(diffPage('booking', PUBLISHED, { title: 'Intro', durations: [30] })).toEqual([]);
    const long = 'A very long meeting title that goes on and on and on';
    expect(diffPage('booking', PUBLISHED, { title: long })[0]).toBe(`Title “Intro” → “${long.slice(0, 39)}…”`);
  });

  it('names a removed limit, a new hours schedule and a count of questions', () => {
    expect(
      diffPage('booking', { ...PUBLISHED, dailyLimit: 3 }, { dailyLimit: null, scheduleId: 'x', questions: [{}] }),
    ).toEqual(['Daily limit removed', 'Hours changed', 'Questions 0 → 1']);
  });
});

describe('diffPage (link)', () => {
  it('names a template and a face change', () => {
    expect(
      diffPage('link', { template: 'classic', avatar: 'circle' }, { template: 'studio', avatar: 'rounded' }),
    ).toEqual(['Template Classic → Studio', 'Face Circle → Rounded']);
    expect(diffPage('link', {}, { template: 'night' })).toEqual(['Template Workspace’s → Night']);
  });
});

describe('the draft’s arithmetic', () => {
  it('reads a stored draft by the shared schema, anything else as none', () => {
    expect(draftOf({ title: 'Hi' })).toEqual({ title: 'Hi' });
    expect(draftOf({ title: 'Hi', status: 'paused' })).toEqual({});
    expect(draftOf(null)).toEqual({});
    expect(draftOf('nope')).toEqual({});
  });

  it('leaves out every setting back at what guests see', () => {
    expect(changedOnly({ title: 'Intro', durations: [45] }, PUBLISHED)).toEqual({ durations: [45] });
  });

  it('keeps a version whole, and makes one a draft of what differs', () => {
    const snapshot = publishedSnapshot({ ...PUBLISHED, title: 'Old' });
    expect(Object.keys(snapshot)).toHaveLength(14);
    expect(draftFromSnapshot(snapshot, PUBLISHED)).toEqual({ title: 'Old' });
    expect(draftFromSnapshot({ title: 7 }, PUBLISHED)).toEqual({});
  });
});
