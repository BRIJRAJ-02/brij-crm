// The one rule for "a required field nothing can fill", which the settings
// guard, the form publish check, the booking page save and the import check
// all read (27 October 2026).
import { describe, expect, it } from 'vitest';
import { ANONYMOUS, BY_MEMBER, isUnfillableRequired, type FillableAttribute } from './required-fillable.ts';

const attribute = (changes: Partial<FillableAttribute> = {}): FillableAttribute => ({
  type: 'status',
  isRequired: true,
  isSystem: false,
  defaultValue: null,
  ...changes,
});

describe('isUnfillableRequired', () => {
  it('is the wall when a field is required with no default at all', () => {
    expect(isUnfillableRequired(attribute(), ANONYMOUS)).toBe(true);
    expect(isUnfillableRequired(attribute({ defaultValue: undefined }), ANONYMOUS)).toBe(true);
    expect(isUnfillableRequired(attribute({ type: 'text' }), ANONYMOUS)).toBe(true);
  });

  it('is no wall once something fills it', () => {
    const withOption = attribute({ defaultValue: { kind: 'static', value: 'option-1' } });
    expect(isUnfillableRequired(withOption, ANONYMOUS)).toBe(false);
    // Not required, filled by the system, or a checkbox, which is false until ticked.
    expect(isUnfillableRequired(attribute({ isRequired: false }), ANONYMOUS)).toBe(false);
    expect(isUnfillableRequired(attribute({ isSystem: true }), ANONYMOUS)).toBe(false);
    expect(isUnfillableRequired(attribute({ type: 'checkbox' }), ANONYMOUS)).toBe(false);
  });

  it('counts a Current user default as nothing for a visitor, and as a value for a member', () => {
    const current = attribute({ type: 'actor_reference', defaultValue: { kind: 'current_user' } });
    expect(isUnfillableRequired(current, ANONYMOUS)).toBe(true);
    expect(isUnfillableRequired(current, BY_MEMBER)).toBe(false);
  });

  it('ignores a default of a kind the type no longer allows, as the engine does', () => {
    // A static default stored on a timestamp before `defaultKindsFor` refused it gives a new record nothing.
    const stale = attribute({ type: 'timestamp', defaultValue: { kind: 'static', value: '2026-01-01T00:00:00.000Z' } });
    expect(isUnfillableRequired(stale, BY_MEMBER)).toBe(true);
    expect(
      isUnfillableRequired(
        attribute({ type: 'timestamp', defaultValue: { kind: 'offset', duration: 'P1D' } }),
        ANONYMOUS,
      ),
    ).toBe(false);
  });

  it('treats anything that is not a stored default as none', () => {
    expect(isUnfillableRequired(attribute({ defaultValue: 'option-1' }), ANONYMOUS)).toBe(true);
    expect(isUnfillableRequired(attribute({ defaultValue: { kind: 'nonsense' } }), ANONYMOUS)).toBe(true);
  });
});
