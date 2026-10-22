import { describe, expect, it } from 'vitest';
import { escapesHere } from './values.ts';

describe('escapesHere', () => {
  it('leaves Esc to the dialog on a form, so the dialog closes from a text field too', () => {
    expect(escapesHere('form', undefined)).toBe(false);
  });

  it('keeps Esc on a form when the caller asks for its own cancel', () => {
    expect(escapesHere('form', () => undefined)).toBe(true);
  });

  it('keeps Esc as the edit cancel in a cell, a panel row, a card, a filter and a preview', () => {
    for (const surface of ['cell', 'panel', 'card', 'filter', 'preview'] as const) {
      expect(escapesHere(surface, undefined), surface).toBe(true);
    }
  });
});
