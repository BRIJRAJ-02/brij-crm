// Bad input on the wire (toApiError, inputProblems): a contract's schema that
// refused the input answers in plain words, on the fields it is about. A
// schema without words of its own gets the safety net's, never Zod's; a
// schema's own words are kept; nothing the person typed comes back.
import { installPlainErrors, PLAIN_ERRORS } from '@crm/contracts';
import { ORPCError, ValidationError } from '@orpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod';
import { INPUT_INVALID_MESSAGE, inputProblems, MAX_INPUT_ISSUES, toApiError } from './errors.ts';

beforeAll(() => {
  installPlainErrors();
});
afterAll(() => {
  z.config({ customError: () => undefined });
});

/** What oRPC throws when a procedure's input schema refuses the input. */
async function refusedBy(schema: z.ZodType, input: unknown): Promise<ORPCError<string, unknown>> {
  const result = await schema['~standard'].validate(input);
  if (result.issues === undefined) throw new Error('The schema took the input.');
  return new ORPCError('BAD_REQUEST', {
    message: 'Input validation failed',
    data: { issues: result.issues },
    cause: new ValidationError({ message: 'Input validation failed', issues: result.issues, data: input }),
  });
}

const ZOD_OWN = /Invalid input|Too small|Too big|Invalid option|Invalid string|expected|received|>=|<=/;

describe('bad input in plain words', () => {
  it('answers a schema with no words of its own in the safety net’s, on each field', async () => {
    const schema = z.object({
      name: z.string().trim().min(1),
      email: z.email(),
      website: z.url(),
      title: z.string().max(60),
      seats: z.number().int().min(1).max(10),
      kind: z.enum(['internal_value_a', 'internal_value_b']),
      handle: z.string().regex(/^[a-z]{3,}$/),
    });
    const { error, expected } = toApiError(
      await refusedBy(schema, {
        name: '   ',
        email: 'ada-private@@',
        website: 'not a site',
        title: 'x'.repeat(61),
        seats: 11,
        kind: 'something-typed',
        handle: 'NO',
      }),
    );
    expect(expected).toBe(true);
    expect(error.code).toBe('INPUT_INVALID');
    expect(error.status).toBe(400);
    expect(error.message).toBe(INPUT_INVALID_MESSAGE);
    expect(error.data).toEqual({
      issues: [
        { path: ['name'], message: 'Add this.' },
        { path: ['email'], message: 'Enter an email address, such as ada@example.com.' },
        { path: ['website'], message: 'Enter a full web address, such as https://example.com.' },
        { path: ['title'], message: 'Use 60 characters or fewer.' },
        { path: ['seats'], message: 'Use 10 or less.' },
        { path: ['kind'], message: 'Pick one of the choices.' },
        { path: ['handle'], message: PLAIN_ERRORS.format },
      ],
    });
    const wire = JSON.stringify(error.toJSON());
    expect(wire).not.toMatch(ZOD_OWN);
    // Never what was typed, a pattern or a choice's internal value.
    for (const echoed of ['ada-private', 'not a site', 'something-typed', 'internal_value', '[a-z]', 'xxxx']) {
      expect(wire).not.toContain(echoed);
    }
  });

  it('keeps the words a schema sets, beside the safety net’s', async () => {
    const schema = z.object({
      name: z.string().trim().min(1, 'Give your name.').max(200, 'Keep your name to 200 characters.'),
      phone: z.string().max(40),
    });
    const { error } = toApiError(await refusedBy(schema, { name: '', phone: '5'.repeat(41) }));
    expect(error.data).toEqual({
      issues: [
        { path: ['name'], message: 'Give your name.' },
        { path: ['phone'], message: 'Use 40 characters or fewer.' },
      ],
    });
  });

  it('says a missing field and a list item by where they are', async () => {
    const schema = z.object({ title: z.string(), guests: z.array(z.email()) });
    const { error } = toApiError(await refusedBy(schema, { guests: ['ada@example.com', 'nope'] }));
    expect(error.data).toEqual({
      issues: [
        { path: ['title'], message: 'Add this.' },
        { path: ['guests', 1], message: 'Enter an email address, such as ada@example.com.' },
      ],
    });
  });

  it('says a rule over the whole input in the sentence only', async () => {
    const schema = z
      .object({ start: z.number(), end: z.number() })
      .refine((input) => input.end > input.start, 'The end time has to be after the start time.');
    const { error } = toApiError(await refusedBy(schema, { start: 2, end: 1 }));
    expect(error.message).toBe('The end time has to be after the start time.');
    expect(error.data).toEqual({ issues: [] });
  });

  it('answers an input that isn’t even the right shape with the plain sentence', async () => {
    const { error } = toApiError(await refusedBy(z.object({ name: z.string() }), 'not an object'));
    expect(error.message).toBe(INPUT_INVALID_MESSAGE);
    expect(error.data).toEqual({ issues: [] });
  });
});

describe('inputProblems', () => {
  it('lists at most the limit, and leads with the first field’s sentence when asked', () => {
    const found = [
      { path: ['name'], message: 'Give your name.', code: 'too_small' },
      { path: ['email'], message: 'Give an email address such as name@example.com.', code: 'invalid_format' },
    ];
    expect(inputProblems(found, { limit: 1 })).toEqual({
      message: INPUT_INVALID_MESSAGE,
      issues: [{ path: ['name'], message: 'Give your name.' }],
    });
    expect(inputProblems(found, { leadWithField: true }).message).toBe('Give your name.');
  });

  it('sends at most 50 issues for the RPC, so a huge bad payload can’t make a huger answer', async () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const { error } = toApiError(await refusedBy(schema, { tags: Array.from({ length: 80 }, () => 1) }));
    expect((error.data as { issues: unknown[] }).issues).toHaveLength(MAX_INPUT_ISSUES);
  });

  it('lets a rule over the whole input lead even when a field’s may', () => {
    const found = [
      { path: ['name'], message: 'Give your name.' },
      { path: [], message: 'Ask for a range of at most 62 days.', code: 'custom' },
    ];
    expect(inputProblems(found, { leadWithField: true })).toEqual({
      message: 'Ask for a range of at most 62 days.',
      issues: [{ path: ['name'], message: 'Give your name.' }],
    });
  });
});
