// The form's Brand look (spec 0063, AC-6327): the `theme` axis of the document, and spec 0060's contrast guard on
// the publish path, so an unreadable pair is refused there and not only on the brand kit's own screen.
import { describe, expect, it } from 'vitest';
import { BRAND_HEX_PATTERN, brandVariables, CONTROL_CONTRAST, contrastRatio, TEXT_CONTRAST } from '../brand-colour.ts';
import { FormDocument, FormLook } from './document.ts';
import { publishProblem, unreadableBrand, type PublishAttribute } from './publish.ts';

const PEOPLE = '0199f0a0-0000-7000-8000-00000000000b';
const EMAIL = '0199f0a0-0000-7000-8000-00000000000e';

describe('FormLook.theme (AC-6327)', () => {
  it('is absent on a document written before this spec, which is the plain look', () => {
    expect(FormLook.parse({ colour: 'light', corners: 'rounded' })).toEqual({ colour: 'light', corners: 'rounded' });
    expect(FormDocument.parse({ questions: [], targets: {} }).look.theme).toBeUndefined();
  });

  it('keeps Brand, and takes nothing else', () => {
    expect(FormLook.parse({ theme: 'brand' }).theme).toBe('brand');
    expect(FormLook.parse({ theme: 'plain' }).theme).toBe('plain');
    expect(FormLook.safeParse({ theme: 'rainbow' }).success).toBe(false);
    // No raw CSS reaches the page through the look: the axis is a closed set of names, never a value (AC-6327).
    expect(FormLook.safeParse({ theme: 'var(--x);color:red' }).success).toBe(false);
  });
});

describe('unreadableBrand (AC-6327, spec 0060 AC-5)', () => {
  it('passes every kit the brand picker can save, light and dark alike', () => {
    for (const accent of ['#1f5fd6', '#ffff00', '#000000', '#ffffff', '#e8590c', '#7c3aed']) {
      expect(BRAND_HEX_PATTERN.test(accent)).toBe(true);
      expect(unreadableBrand({ accent })).toBeUndefined();
      const colours = brandVariables({ accent });
      // What the guard promises, checked here too, so this test fails if the guard ever stops keeping it.
      expect(contrastRatio(colours.light.accent, colours.light.onAccent)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
      expect(contrastRatio(colours.light.accent, '#ffffff')).toBeGreaterThanOrEqual(CONTROL_CONTRAST);
    }
  });

  it('refuses a pair that never went through the picker, in one sentence', () => {
    const message = unreadableBrand({ accent: 'rebeccapurple' });
    expect(message).toBe(
      'This form wears your brand colour, and it can’t be made readable. Change it in Settings › Brand.',
    );
    expect(unreadableBrand({ accent: '#1f5fd6', accentDark: '#FFF' })).toBe(message);
  });
});

describe('publishProblem on the Brand look (AC-6327)', () => {
  const attributes = new Map<string, PublishAttribute>([
    [EMAIL, { id: EMAIL, title: 'Email', type: 'email', objectName: 'Person', canWrite: true }],
  ]);
  const document = FormDocument.parse({
    questions: [
      {
        id: 'q1',
        key: 'email',
        label: 'Work email',
        answerType: 'email',
        required: true,
        filedOn: { objectRole: 'main', attributeId: EMAIL },
      },
    ],
    targets: { main: { objectId: PEOPLE, matchAttributeId: EMAIL } },
  });
  const check = (look: FormDocument['look'], brand?: { readonly accent: string; readonly accentDark?: string }) =>
    publishProblem({
      name: 'Demo',
      slug: 'demo',
      document: { ...document, look },
      attributes,
      ...(brand === undefined ? {} : { brand }),
    });

  it('publishes a Brand form whose kit is readable', () => {
    expect(check({ colour: 'light', corners: 'rounded', theme: 'brand' }, { accent: '#1f5fd6' })).toBeUndefined();
  });

  it('refuses a Brand form whose kit cannot be read, naming where to change it', () => {
    expect(check({ colour: 'light', corners: 'rounded', theme: 'brand' }, { accent: 'red; }' })).toEqual({
      code: 'BRAND_UNREADABLE',
      message: 'This form wears your brand colour, and it can’t be made readable. Change it in Settings › Brand.',
    });
  });

  it('leaves a plain form alone, whatever the workspace saved', () => {
    expect(check({ colour: 'light', corners: 'rounded', theme: 'plain' }, { accent: 'red; }' })).toBeUndefined();
    expect(check({ colour: 'light', corners: 'rounded' }, { accent: 'red; }' })).toBeUndefined();
  });

  it('publishes a Brand form on a workspace that saved no colour, which is the product accent', () => {
    expect(check({ colour: 'dark', corners: 'square', theme: 'brand' })).toBeUndefined();
  });
});
