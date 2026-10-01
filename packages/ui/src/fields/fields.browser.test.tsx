// The field set, end to end (spec 0003). AC-4: every attribute type has one
// entry, and its one display and editor render on each of the six surfaces
// through AttributeDisplay and AttributeEditor. AC-5: editors refuse invalid
// input with a sentence and emit only values that parse. Text conversion
// round trips where the type allows it.
import { AttributeType, parseAttributeValue } from '@crm/contracts/values';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixedClock } from '../provider/clock.ts';
import { createToasts } from '../provider/toasts.tsx';
import { UiProvider } from '../provider/UiProvider.tsx';
import { attributeOf } from '../workbench/attributes.ts';
import { FIELD_SAMPLES } from '../workbench/field-samples.ts';
import { AttributeDisplay } from './AttributeDisplay.tsx';
import { AttributeEditor } from './AttributeEditor.tsx';
import { checkDomain } from './Domain/DomainEditor.tsx';
import { parseLocaleDate } from './Date/parse-date.ts';
import { checkEmail } from './Email/EmailEditor.tsx';
import { nameFromText } from './PersonalName/type.ts';
import { checkPhone } from './Phone/PhoneEditor.tsx';
import { createPhoneParser, loadPhoneLibrary } from './Phone/phone-library.ts';
import { FIELD_TYPES, fieldTypeOf } from './registry.ts';
import { optionByLabel } from './Select/type.ts';
import type { Surface, TextContext } from './types.ts';
import { isRefusal, toCommittable } from './values.ts';

const SURFACES: readonly Surface[] = ['cell', 'panel', 'card', 'form', 'filter', 'preview'];
const mounted: (() => void)[] = [];

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

/** Renders inside the provider, as the app and stories do, and waits a frame. */
async function render(node: ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <UiProvider
      locale="en-US"
      timeZone="Europe/London"
      navigate={() => undefined}
      toasts={createToasts()}
      clock={createFixedClock(Date.UTC(2026, 9, 8, 14, 30))}
      platform="mac"
    >
      {node}
    </UiProvider>,
  );
  mounted.push(() => {
    root.unmount();
    host.remove();
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  return host;
}

function contextFor(type: AttributeType): TextContext {
  return { locale: 'en-US', timeZone: 'Europe/London', attribute: FIELD_SAMPLES[type].attribute };
}

describe('the registry (AC-4)', () => {
  it('has exactly one entry per attribute type', () => {
    expect(Object.keys(FIELD_TYPES).sort()).toEqual([...AttributeType.options].sort());
    for (const type of AttributeType.options) expect(fieldTypeOf(type).type).toBe(type);
  });

  it('gives every type its operators, ending with is empty and is not empty (checkbox is never empty)', () => {
    for (const type of AttributeType.options) {
      const operators = fieldTypeOf(type)
        .operators(FIELD_SAMPLES[type].attribute)
        .map((operator) => operator.operator);
      expect(operators.length, type).toBeGreaterThan(0);
      if (type === 'checkbox') expect(operators).toEqual(['is_checked', 'is_not_checked']);
      else expect(operators.slice(-2), type).toEqual(['is_empty', 'is_not_empty']);
    }
  });

  it('offers a select different operators when it holds several', () => {
    const several = FIELD_SAMPLES.select.several?.attribute ?? FIELD_SAMPLES.select.attribute;
    expect(
      fieldTypeOf('select')
        .operators(several)
        .map((operator) => operator.operator),
    ).toContain('contains_all_of');
    expect(
      fieldTypeOf('select')
        .operators(FIELD_SAMPLES.select.attribute)
        .map((operator) => operator.operator),
    ).toContain('is_any_of');
  });
});

describe('every type on every surface (AC-4)', () => {
  for (const type of AttributeType.options) {
    it(`${type}: draws its value on all six surfaces through AttributeDisplay`, async () => {
      const sample = FIELD_SAMPLES[type];
      const host = await render(
        <>
          {SURFACES.map((surface) => (
            <div key={surface} data-surface={surface}>
              <AttributeDisplay
                attribute={sample.attribute}
                value={sample.value as never}
                surface={surface}
                {...(sample.display === undefined ? {} : { display: sample.display as never })}
              />
            </div>
          ))}
        </>,
      );
      for (const surface of SURFACES) {
        const slot = host.querySelector(`[data-surface="${surface}"]`);
        expect(slot?.childElementCount, `${type} on ${surface}`).toBeGreaterThan(0);
        expect(slot?.textContent, `${type} on ${surface}`).not.toContain('Empty');
      }
    });

    it(`${type}: edits on all six surfaces through AttributeEditor`, async () => {
      const sample = FIELD_SAMPLES[type];
      const host = await render(
        <>
          {SURFACES.map((surface) => (
            <div key={surface} data-surface={surface}>
              <AttributeEditor
                attribute={sample.attribute}
                value={sample.value as never}
                surface={surface}
                onCommit={() => undefined}
                {...(sample.display === undefined ? {} : { display: sample.display as never })}
              />
            </div>
          ))}
        </>,
      );
      for (const surface of SURFACES) {
        expect(
          host.querySelector(`[data-surface="${surface}"]`)?.childElementCount,
          `${type} on ${surface}`,
        ).toBeGreaterThan(0);
      }
    });

    it(`${type}: an empty value reads "Empty" to screen readers`, async () => {
      if (type === 'checkbox' || type === 'rating') return;
      const host = await render(
        <AttributeDisplay attribute={FIELD_SAMPLES[type].attribute} value={null} surface="cell" />,
      );
      expect(host.textContent).toContain('Empty');
    });
  }
});

describe('editors emit only what parses (AC-5)', () => {
  it('turns empty into null, or a required error', () => {
    expect(toCommittable(attributeOf('text', 'Name'), '')).toEqual({ ok: true, value: null });
    expect(toCommittable(attributeOf('text', 'Name', { isRequired: true }), '')).toEqual({
      ok: false,
      message: 'Name is required.',
    });
  });

  it('refuses an email without a domain', () => {
    const checked = checkEmail('ada@example');
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.message).toMatch(/with a name and a domain/);
  });

  it('refuses a domain with a space, and strips a protocol and path', () => {
    expect(checkDomain('north wind.com').ok).toBe(false);
    expect(checkDomain('https://www.Northwind.com/about?ref=1')).toEqual({ ok: true, value: 'www.northwind.com' });
    expect(checkDomain('bücher.de')).toEqual({ ok: true, value: 'xn--bcher-kva.de' });
  });

  it('refuses a number with five decimals', () => {
    expect(toCommittable(attributeOf('number', 'Score'), '1.23456').ok).toBe(false);
  });

  it('refuses a phone that is not a number, and reads one in its country', async () => {
    const library = await loadPhoneLibrary();
    expect(checkPhone('not a number', library, 'GB').ok).toBe(false);
    expect(checkPhone('020 7123 4567', library, 'GB')).toEqual({
      ok: true,
      value: { number: '+442071234567', country: 'GB' },
    });
    expect(checkPhone('anything', undefined, 'GB')).toEqual({
      ok: false,
      message: expect.stringMatching(/loading/) as unknown,
    });
  });

  it('emits values that parse with their schema for every sample', () => {
    for (const type of AttributeType.options) {
      const sample = FIELD_SAMPLES[type];
      expect(parseAttributeValue(type, sample.value, { allowMultiple: sample.attribute.allowMultiple }).ok, type).toBe(
        true,
      );
    }
  });
});

describe('text out and back in', () => {
  const ROUND_TRIPS: readonly AttributeType[] = [
    'text',
    'long_text',
    'number',
    'currency',
    'date',
    'checkbox',
    'select',
    'status',
    'rating',
    'email',
    'domain',
    'url',
    'personal_name',
  ];

  for (const type of ROUND_TRIPS) {
    it(`${type}: fromText(toText(value)) is the value`, () => {
      const definition = fieldTypeOf(type);
      const sample = FIELD_SAMPLES[type];
      const text = definition.toText(sample.value as never, contextFor(type));
      const back = definition.fromText(text, contextFor(type));
      expect(isRefusal(back), `${type}: ${text}`).toBe(false);
      expect(back).toEqual(sample.value);
    });
  }

  it('reads dates in ISO and the language’s order', () => {
    expect(parseLocaleDate('2026-10-08', 'en-US')).toBe('2026-10-08');
    expect(parseLocaleDate('10/8/2026', 'en-US')).toBe('2026-10-08');
    expect(parseLocaleDate('08.10.2026', 'de-DE')).toBe('2026-10-08');
    expect(parseLocaleDate('8/10/26', 'en-GB')).toBe('2026-10-08');
    expect(parseLocaleDate('31/02/2026', 'en-GB')).toBeUndefined();
  });

  it('reads names "Last, First" or split at the first space', () => {
    expect(nameFromText('Lovelace, Ada')).toEqual({ firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' });
    expect(nameFromText('Grace Brewster Hopper')).toEqual({
      firstName: 'Grace',
      lastName: 'Brewster Hopper',
      fullName: 'Grace Brewster Hopper',
    });
  });

  it('refuses an unknown or archived select option by label', () => {
    const attribute = FIELD_SAMPLES.select.attribute;
    expect(optionByLabel(attribute, 'saas')).toBe('saas');
    expect(optionByLabel(attribute, 'Hot')).toEqual({ code: 'TEXT_REFUSED', reason: 'No option called “Hot”.' });
    expect(isRefusal(optionByLabel(attribute, 'Old segment'))).toBe(true);
  });

  it('pastes phones only with the library loaded, through TextContext.phone', async () => {
    const library = await loadPhoneLibrary();
    const context = { ...contextFor('phone'), phone: createPhoneParser(library) };
    expect(fieldTypeOf('phone').fromText('+44 20 7123 4567', context)).toEqual({
      number: '+442071234567',
      country: 'GB',
    });
    expect(isRefusal(fieldTypeOf('phone').fromText('+44 20 7123 4567', contextFor('phone')))).toBe(true);
  });
});
