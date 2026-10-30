// The routing card's and the forms' confirm words (Q64 to Q66): a rule is named in its remove question by its name
// or its place, never "1. Name"; nothing says "the fallback"; a form's delete question doesn't say "form" twice; and
// Publish's object button says it makes an object.
import { describe, expect, it } from 'vitest';
import { strings as forms } from '../forms/strings.ts';
import { strings } from './strings.ts';

describe('routing and forms confirm words', () => {
  it('names a rule by its name, or by its place when it has none', () => {
    expect(strings.removeTitle(0, 'Enterprise')).toBe('Remove “Enterprise”?');
    expect(strings.removeTitle(1, undefined)).toBe('Remove rule 2?');
    expect(strings.removeTitle(1, '')).toBe('Remove rule 2?');
    expect(strings.removeText('form')).toBe('Its leads go to the next rule, or After sending.');
    expect(strings.removeText('page')).toBe('Its leads go to the next rule, or the whole rotation.');
    expect(strings.removeText('form')).not.toMatch(/fallback/);
  });

  it('asks to delete a form by its name, once', () => {
    expect(forms.deleteTitle('Contact form')).toBe('Delete “Contact form”?');
  });

  it('says the publish step’s button makes an object', () => {
    expect(forms.buildObjectButton('Contact form', 4)).toBe('Make an object named “Contact form” with 4 attributes');
    expect(forms.buildObjectButton('Untitled form', 1)).toBe('Make an object named “Untitled form” with 1 attribute');
  });
});
