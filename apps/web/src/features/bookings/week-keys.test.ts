import { describe, expect, it } from 'vitest';
import { weekKeyAction } from './week-keys.ts';

const press = (
  key: string,
  extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; repeat: boolean }> = {},
) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...extra,
});

describe('weekKeyAction', () => {
  it.each([
    ['t', 'today'],
    ['T', 'today'],
    ['j', 'next'],
    ['k', 'previous'],
    ['d', 'day'],
    ['w', 'week'],
  ])('reads %j as %s', (key, action) => {
    expect(weekKeyAction(press(key))).toBe(action);
  });

  it('leaves presses with a modifier, held keys and other keys alone', () => {
    expect(weekKeyAction(press('t', { metaKey: true }))).toBeUndefined();
    expect(weekKeyAction(press('j', { ctrlKey: true }))).toBeUndefined();
    expect(weekKeyAction(press('k', { altKey: true }))).toBeUndefined();
    expect(weekKeyAction(press('j', { repeat: true }))).toBeUndefined();
    expect(weekKeyAction(press('x'))).toBeUndefined();
    expect(weekKeyAction(press('ArrowRight'))).toBeUndefined();
  });
});
