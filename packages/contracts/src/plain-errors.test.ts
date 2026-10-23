// The safety net under every schema (`installPlainErrors`): a person never
// sees Zod's own English ("Too small: expected string to have >=1
// characters"), a type name, a pattern, a choice's internal value or what they
// typed. A schema's own words always win. The most used typed fields say
// something specific, and a walk over every contract input proves no failure
// anywhere falls through to Zod's text.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod';
import { PublicBookInput, PublicGuestsInput } from './booking/public.ts';
import { BookingPageSettings, BookingSlug } from './booking/settings.ts';
import { FormSlug, SlugInput } from './forms/forms.ts';
import { contract } from './index.ts';
import { installPlainErrors, isPlainFallback, PLAIN_ERRORS, plainIssueMessage } from './plain-errors.ts';
import { MemberName, PublicHandle } from './profile.ts';
import { TaskTitle } from './tasks.ts';
import { EmailValue, PersonalNameValue, TextValue } from './values/attribute-values.ts';
import { CreateWorkspaceInput, WorkspaceSlug } from './workspaces.ts';

beforeAll(() => {
  installPlainErrors();
});
afterAll(() => {
  z.config({ customError: () => undefined });
});

/** Zod's own English, which no message may start with or carry. */
const ZOD_OWN =
  /^(Invalid input|Too small|Too big|Invalid string|Invalid option|Invalid email|Invalid URL|Invalid UUID|Invalid ISO|Invalid number|Invalid key|Invalid element|Unrecognized key)|expected (string|number|int|one of)|received |[<>]=/;

/** Every message a schema gives for an input, first to last. */
function messagesOf(schema: z.ZodType, input: unknown): string[] {
  const parsed = schema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

/** The one message for a field's value inside its schema. */
function messageOn(schema: z.ZodType, input: unknown, field: string): string | undefined {
  const parsed = schema.safeParse(input);
  return parsed.success ? undefined : parsed.error.issues.find((issue) => issue.path[0] === field)?.message;
}

/** House style: a whole sentence, plain words, no dash or exclamation, nothing typed echoed back. */
function expectPlain(message: string | undefined, typed: string): void {
  expect(message).toBeDefined();
  expect(message).toMatch(/^[A-Z0-9].*\.$/);
  expect(message).not.toMatch(ZOD_OWN);
  expect(message).not.toMatch(/[!–—]| - /);
  if (typed.trim().length >= 4) expect(message).not.toContain(typed.trim());
}

describe('plainIssueMessage', () => {
  it('says a missing or empty field needs filling', () => {
    expect(messagesOf(z.object({ name: z.string() }), {})).toEqual([PLAIN_ERRORS.missing]);
    expect(messagesOf(z.string().trim().min(1), '   ')).toEqual(['Add this.']);
    expect(messagesOf(z.array(z.string()).min(1), [])).toEqual(['Add at least one.']);
  });

  it('gives limits as plain counts', () => {
    expect(messagesOf(z.string().max(60), 'x'.repeat(61))).toEqual(['Use 60 characters or fewer.']);
    expect(messagesOf(z.string().min(3), 'ab')).toEqual(['Use 3 characters or more.']);
    expect(messagesOf(z.string().max(2000), 'x'.repeat(2001))).toEqual(['Use 2,000 characters or fewer.']);
    expect(messagesOf(z.string().length(6), '12345')).toEqual(['Use exactly 6 characters.']);
    expect(messagesOf(z.number().min(1), 0)).toEqual(['Use 1 or more.']);
    expect(messagesOf(z.number().max(50), 51)).toEqual(['Use 50 or less.']);
    expect(messagesOf(z.number().positive(), 0)).toEqual(['Use a number above 0.']);
    expect(messagesOf(z.number().int(), 1.5)).toEqual(['Use a whole number.']);
    expect(messagesOf(z.number(), 'ten')).toEqual(['Enter a number.']);
    expect(messagesOf(z.number().multipleOf(15), 20)).toEqual(['Use a multiple of 15.']);
    expect(
      messagesOf(
        z.array(z.string()).max(10),
        Array.from({ length: 11 }, () => 'a'),
      ),
    ).toEqual(['Use 10 or fewer.']);
  });

  it('names the shape an address or date takes, never the pattern', () => {
    expect(messagesOf(z.email(), 'grace@')).toEqual(['Enter an email address, such as ada@example.com.']);
    expect(messagesOf(z.url(), 'not a site')).toEqual(['Enter a full web address, such as https://example.com.']);
    expect(messagesOf(z.hostname(), 'not a site')).toEqual(['Enter a web address, such as example.com.']);
    expect(messagesOf(z.iso.date(), '2026-02-31x')).toEqual(['This isn’t a valid date.']);
    expect(messagesOf(z.iso.datetime(), 'tomorrow')).toEqual(['This isn’t a valid date.']);
    expect(messagesOf(z.e164(), '0770')).toEqual([PLAIN_ERRORS.phone]);
    expect(messagesOf(z.string().regex(/^[a-z]+$/), 'ABC')).toEqual(['This isn’t in the right format.']);
    expect(messagesOf(z.uuid(), 'nope')).toEqual(['This isn’t in the right format.']);
  });

  it('says a choice without listing what the choices are inside', () => {
    expect(messagesOf(z.enum(['owner_internal', 'member_internal']), 'boss')).toEqual(['Pick one of the choices.']);
    expect(messagesOf(z.literal('member'), 'owner')).toEqual(['Pick one of the choices.']);
    const tagged = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a') }),
      z.object({ kind: z.literal('b') }),
    ]);
    expect(messagesOf(tagged, { kind: 'c' })).toEqual(['Pick one of the choices.']);
  });

  it('never repeats what was typed or names a key it refused', () => {
    const typed = 'my-secret-value';
    for (const [schema, input] of [
      [z.email(), typed],
      [z.enum(['a', 'b']), typed],
      [z.string().max(3), typed],
      [z.strictObject({ name: z.string() }), { name: 'Ada', [typed]: 1 }],
      [z.number(), typed],
    ] as const) {
      for (const message of messagesOf(schema, input)) expectPlain(message, typed);
    }
  });

  it('keeps every message a schema sets: on the schema, on a check, or pushed by a rule', () => {
    expect(messagesOf(z.string().min(1, 'Give your name.'), '')).toEqual(['Give your name.']);
    expect(messagesOf(z.email({ error: 'That isn’t an email address.' }), 'x')).toEqual([
      'That isn’t an email address.',
    ]);
    expect(
      messagesOf(
        z.string().refine(() => false, 'Pick a question or a field.'),
        'x',
      ),
    ).toEqual(['Pick a question or a field.']);
    // A refinement with no words of its own gets the safety net's.
    expect(
      messagesOf(
        z.string().refine(() => false),
        'x',
      ),
    ).toEqual(['This isn’t valid.']);
  });

  it('answers any code it doesn’t know in plain words too', () => {
    expect(plainIssueMessage({ code: 'custom', input: 'x', path: [] })).toBe('This isn’t valid.');
  });

  it('installs into the one config Zod reads, without loading Zod, and keeps the rest of it', () => {
    // installPlainErrors writes Zod's global config object itself; this fails if a Zod upgrade moves it.
    const config = z.config();
    expect(config.customError).toBe(plainIssueMessage);
    expect(config.localeError).toBeDefined();
    installPlainErrors();
    expect(z.config()).toBe(config);
    expect(z.config().customError).toBe(plainIssueMessage);
  });

  it('knows its own sentences, so a toast never shows one alone', () => {
    const own = [
      ...Object.values(PLAIN_ERRORS),
      ...messagesOf(z.string().min(3), 'ab'),
      ...messagesOf(z.string().max(2000), 'x'.repeat(2001)),
      ...messagesOf(z.string().length(6), '1'),
      ...messagesOf(z.number().min(-5), -6),
      ...messagesOf(z.number().max(0.5), 1),
      ...messagesOf(z.number().positive(), 0),
      ...messagesOf(z.number().lt(10), 10),
      ...messagesOf(z.number().multipleOf(15), 20),
      ...messagesOf(z.array(z.string()).min(2), []),
      ...messagesOf(z.array(z.string()).max(1), ['a', 'b']),
      ...messagesOf(z.array(z.string()).length(2), ['a']),
    ];
    for (const message of own) expect(isPlainFallback(message), message).toBe(true);
    for (const message of ['Give your name.', 'Keep the title to 120 characters.', 'Use 3 to 40 lowercase letters.']) {
      expect(isPlainFallback(message), message).toBe(false);
    }
  });
});

describe('the most used typed fields', () => {
  const booking = {
    idempotencyKey: '0192f2a0-7c1e-7cc0-9a51-6f2d2b9a1c3e',
    start: '2026-10-23T09:00:00.000Z',
    duration: 30,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    timeZone: 'Europe/London',
  };

  it('the public booking form: name, email, phone and guests', () => {
    expect(PublicBookInput.safeParse(booking).success).toBe(true);
    const on = (field: string, value: unknown) => messageOn(PublicBookInput, { ...booking, [field]: value }, field);
    expect(on('name', '  ')).toBe('Give your name.');
    expect(on('name', 'a'.repeat(201))).toBe('Keep your name to 200 characters.');
    expect(on('email', 'ada-at-example')).toBe('Give an email address such as name@example.com.');
    expect(on('email', undefined)).toBe('Give an email address such as name@example.com.');
    expect(on('phone', '+44 '.repeat(11))).toBe('Keep the phone number to 40 characters.');
    expect(on('guests', ['grace@example.com', 'not-an-email'])).toBe('Give each guest’s email address.');
    expect(
      on(
        'guests',
        Array.from({ length: 11 }, (_, index) => `g${String(index)}@example.com`),
      ),
    ).toBe('Invite at most 10 guests.');
    for (const [field, value] of [
      ['name', ''],
      ['email', 'typed-not-an-email'],
      ['phone', 'x'.repeat(41)],
      ['guests', ['typed-not-an-email']],
      ['note', 'x'.repeat(2001)],
    ] as const) {
      expectPlain(on(field, value), typeof value === 'string' ? value : value.join(' '));
    }
    expect(messagesOf(PublicGuestsInput, { emails: [] })).toEqual(['Add at least one email address.']);
  });

  it('sign up and sign in: the email', () => {
    for (const typed of ['', 'grace', 'grace@', '@hopper.dev', `${'g'.repeat(250)}@hopper.dev`]) {
      const [message] = messagesOf(EmailValue, typed);
      expectPlain(message, typed);
    }
    expect(messagesOf(EmailValue, 'grace@')).toEqual([
      'Enter an email address with a name and a domain, such as ada@example.com.',
    ]);
  });

  it('handles, slugs and titles', () => {
    for (const [schema, typed] of [
      [PublicHandle, 'NO'],
      [PublicHandle, 'bad handle!!'],
      [WorkspaceSlug, 'Bad Slug'],
      [BookingSlug, ''],
      [BookingSlug, 'x'.repeat(61)],
      [BookingSlug, 'Bad_Slug'],
      [FormSlug, 'x'],
      [TaskTitle, ''],
      [MemberName, ''],
      [MemberName, 'x'.repeat(81)],
    ] as const) {
      const [message] = messagesOf(schema, typed);
      expectPlain(message, typed);
    }
    expect(
      messageOn(SlugInput, { workspace: 'acme', formId: booking.idempotencyKey, slug: 'x'.repeat(61) }, 'slug'),
    ).toBe('The address needs 2 to 40 lowercase letters, numbers or hyphens.');
    const settings = BookingPageSettings.safeParse({ title: '' });
    expect(settings.success).toBe(false);
    expect(settings.error?.issues.find((issue) => issue.path[0] === 'title')?.message).toBe('Give the page a title.');
    const workspace = messageOn(CreateWorkspaceInput, { name: '', slug: 'acme', memberName: 'Ada' }, 'name');
    expectPlain(workspace, '');
  });

  it('record values a person types', () => {
    expectPlain(messagesOf(TextValue, 'x'.repeat(501))[0], 'x'.repeat(501));
    expect(messagesOf(PersonalNameValue, { firstName: ' ', lastName: 'Lovelace' })).toEqual([
      'Fill in the name, or clear it.',
    ]);
  });
});

describe('every contract input', () => {
  type Schema = z.ZodType & { readonly _zod: { readonly def: Record<string, unknown> } };
  const LONG = 'x'.repeat(300_000);
  const PROBES: Readonly<Record<string, readonly unknown[]>> = {
    string: [undefined, null, 123, '', ' ', 'x', LONG, 'not valid @@ //', 'ab'],
    number: [undefined, 'abc', -1e12, 1e12, 1.5, Number.NaN],
    enum: [undefined, 'not-a-choice'],
  };

  /** Each scalar leaf of a schema, as the outermost schema at its place (optional, piped, defaulted). */
  function leaves(schema: Schema, at: Schema | undefined, seen: ReadonlySet<unknown>): [Schema, string][] {
    const def = schema._zod.def;
    if (seen.has(schema)) return [];
    const here = at ?? schema;
    const next = new Set(seen).add(schema);
    const child = (value: unknown, wrapper?: Schema) => leaves(value as Schema, wrapper, next);
    switch (def.type) {
      case 'string':
      case 'number':
      case 'enum':
        return [[here, def.type]];
      case 'object':
        return Object.values(def.shape as Record<string, unknown>).flatMap((value) => child(value));
      case 'array':
        return child(def.element);
      case 'record':
        return child(def.valueType);
      case 'tuple':
        return (def.items as unknown[]).flatMap((item) => child(item));
      case 'union':
        return (def.options as unknown[]).flatMap((option) => child(option));
      case 'intersection':
        return [...child(def.left), ...child(def.right)];
      case 'optional':
      case 'nullable':
      case 'default':
      case 'prefault':
      case 'nonoptional':
      case 'catch':
      case 'readonly':
        return leaves(def.innerType as Schema, here, seen);
      case 'pipe':
        return [...leaves(def.in as Schema, here, seen), ...child(def.out)];
      case 'lazy':
        return child((def.getter as () => unknown)());
      default:
        return [];
    }
  }

  function inputs(node: unknown, name: string): [string, Schema][] {
    if (typeof node !== 'object' || node === null) return [];
    if ('~orpc' in node) {
      const input = (node['~orpc'] as { inputSchema?: Schema }).inputSchema;
      return input === undefined ? [] : [[name, input]];
    }
    return Object.entries(node).flatMap(([key, value]) => inputs(value, name === '' ? key : `${name}.${key}`));
  }

  it('answers every failure of every field in plain words, never Zod’s', () => {
    const procedures = [
      ...inputs(contract, ''),
      ['public book', PublicBookInput as unknown as Schema],
      ['public guests', PublicGuestsInput as unknown as Schema],
    ] as const;
    expect(procedures.length).toBeGreaterThan(200);
    const raw: string[] = [];
    for (const [name, input] of procedures) {
      for (const [leaf, kind] of leaves(input, undefined, new Set())) {
        for (const probe of PROBES[kind] ?? []) {
          const parsed = leaf.safeParse(probe);
          if (parsed.success) continue;
          for (const issue of parsed.error.issues) {
            if (ZOD_OWN.test(issue.message) || !/[.?]$/.test(issue.message)) raw.push(`${name}: ${issue.message}`);
            // Never what was typed, either: a schema's own words included.
            const typed = typeof probe === 'string' ? probe.trim() : '';
            if (typed.length >= 4 && issue.message.includes(typed)) raw.push(`${name} echoes: ${issue.message}`);
          }
        }
      }
    }
    expect([...new Set(raw)]).toEqual([]);
  });
});
