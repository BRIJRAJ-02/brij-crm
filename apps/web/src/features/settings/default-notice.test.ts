import { describe, expect, it } from 'vitest';
import { defaultArchivedNotice } from './default-notice.ts';

const options = [
  { id: 'new', label: 'New' },
  { id: 'won', label: 'Won' },
  { id: 'old', label: 'Old', isArchived: true },
];
const stage = (isRequired: boolean, value: unknown) => ({
  title: 'Stage',
  isRequired,
  defaultValue: { kind: 'static' as const, value },
});

describe('archiving the option a default names (late trap #34)', () => {
  it('says new records now start with nothing, or at the first live option when the field is required', () => {
    expect(defaultArchivedNotice(stage(false, 'new'), options, 'new')).toBe(
      'New archived, so new records get no Stage.',
    );
    expect(defaultArchivedNotice(stage(true, 'new'), options, 'new')).toBe(
      'New archived, so new records get Won as their Stage.',
    );
    // Required, with every other option archived too: nothing stands in.
    const alone = [
      { id: 'new', label: 'New' },
      { id: 'old', label: 'Old', isArchived: true },
    ];
    expect(defaultArchivedNotice(stage(true, 'new'), alone, 'new')).toBe('New archived, so new records get no Stage.');
  });

  it('says a several value default goes on without it, and nothing when the default names another option', () => {
    expect(defaultArchivedNotice(stage(false, ['new', 'won']), options, 'new')).toBe(
      'New archived, so Stage’s default gives new records the others.',
    );
    expect(defaultArchivedNotice(stage(false, 'won'), options, 'new')).toBeUndefined();
    expect(defaultArchivedNotice({ title: 'Stage', isRequired: false }, options, 'new')).toBeUndefined();
  });
});
