// The forms QA lane's pure checks (5 November 2026, "bulletproof before release"): every answer type refuses bad
// input with the message the visitor reads, long answers stop at their limit, a form holds exactly its 50 questions,
// a rule left pointing at a deleted question never strands a visitor and never publishes, markup in an answer is kept
// as the characters it is, every spreadsheet formula start is guarded in a CSV cell, and an upload's name and bytes
// can't pass as another type. These hold today; they run again unchanged once the three forms lanes merge.
import { describe, expect, it } from 'vitest';
import { csvCell, csvLine, unguardCell } from '../csv.ts';
import { FORM_QUESTIONS_MAX } from './answer-types.ts';
import { LONG_ANSWER_MAX, SHORT_ANSWER_MAX } from './answer-keys.ts';
import { checkAnswers, type CheckedForm } from './check.ts';
import { defaultQuestions, FormDocument, type FormQuestion } from './document.ts';
import { publishProblem, type PublishAttribute } from './publish.ts';
import { formStrings } from './strings.ts';
import { FORM_UPLOAD_TYPES, matchesContent, sanitiseFileName, uploadTypeOf } from './uploads.ts';

const words = formStrings('en');
const PEOPLE = '0199f0a0-0000-7000-8000-00000000000b';
const EMAIL = '0199f0a0-0000-7000-8000-00000000000e';

/** A one question form of `answerType`, required, with `extra` (choices, options). */
function one(answerType: CheckedForm['questions'][number]['answerType'], extra: object = {}): CheckedForm {
  return { language: 'en', questions: [{ key: 'q', answerType, required: true, ...extra }] };
}

/** The message the visitor reads for `raw` on a one question form, or undefined when it is taken. */
function messageFor(form: CheckedForm, raw: unknown): string | undefined {
  const checked = checkAnswers(form, { q: raw });
  return checked.ok ? undefined : checked.fields.q;
}

describe('every answer type refuses bad input with the message the visitor reads', () => {
  const cases: readonly [string, CheckedForm, unknown, string][] = [
    ['an email with no domain', one('email'), 'ada@', words.email],
    ['an email with two @', one('email'), 'ada@@example.com', words.email],
    ['an email with a space', one('email'), 'ada lovelace@example.com', words.email],
    ['an email with no dot in its domain', one('email'), 'ada@localhost', words.email],
    ['an email past 254 characters', one('email'), `${'a'.repeat(250)}@example.com`, words.tooLong],
    ['a phone of letters', one('phone'), { number: 'abc', country: 'US' }, words.phone],
    ['a phone too short', one('phone'), { number: '+112', country: 'US' }, words.phone],
    ['a phone too long', one('phone'), { number: '+1234567890123456', country: 'US' }, words.phone],
    ['a phone with a made up country', one('phone'), { number: '+14155550101', country: 'usa' }, words.phone],
    ['a phone typed with no code', one('phone'), '4155550101', words.phone],
    ['a web address with no dot', one('website'), 'localhost', words.website],
    ['a javascript: address', one('website'), 'javascript:alert(1)', words.website],
    ['a javascript:// address', one('website'), 'javascript://acme.com/%0aalert(1)', words.website],
    ['a data: address', one('website'), 'data:text/html,<script>alert(1)</script>', words.website],
    ['a file:// address', one('website'), 'file:///etc/passwd', words.website],
    ['a web address past 2,048 characters', one('website'), `https://acme.com/${'a'.repeat(2_100)}`, words.website],
    ['a number of words', one('number'), 'ten', words.number],
    ['a number in e notation', one('number'), '1e9', words.number],
    ['a number with two points', one('number'), '1.2.3', words.number],
    ['a number past 40 digits', one('number'), '9'.repeat(41), words.number],
    ['Infinity as a number', one('number'), 'Infinity', words.number],
    ['a date that is no day', one('date'), '2026-02-30', words.date],
    ['a date in another shape', one('date'), '30/01/2026', words.date],
    [
      'a date before the earliest',
      one('date', { options: { earliest: '2026-01-01' } }),
      '2025-12-31',
      words.dateFrom('2026-01-01'),
    ],
    [
      'a date after the latest',
      one('date', { options: { latest: '2026-12-31' } }),
      '2027-01-01',
      words.dateUntil('2026-12-31'),
    ],
    ['a time of 25 hours', one('time'), '25:00', words.time],
    ['a time of 60 minutes', one('time'), '10:60', words.time],
    ['a date and time with no offset', one('datetime'), '2026-11-05T10:00', words.datetime],
    [
      'a date and time in a made up zone',
      one('datetime'),
      { at: '2026-11-05T10:00Z', timeZone: 'Mars/Olympus' },
      words.datetime,
    ],
    ['a rating of 6', one('rating'), 6, words.pickOption],
    ['a rating of 2.5', one('rating'), 2.5, words.pickOption],
    ['a scale past its top', one('scale', { options: { from: 0, to: 10 } }), 11, words.pickOption],
    ['a choice the question doesn’t offer', one('choice', { choices: ['Red', 'Blue'] }), 'Green', words.pickOption],
    ['a dropdown answer that isn’t text', one('dropdown', { choices: ['Red'] }), ['Red'], words.pickOption],
    [
      'a multi select naming a choice it lacks',
      one('multi_select', { choices: ['A', 'B'] }),
      ['A', 'Z'],
      words.pickOption,
    ],
    [
      'a multi select past its most',
      one('multi_select', { choices: ['A', 'B', 'C'], options: { max: 2 } }),
      ['A', 'B', 'C'],
      words.pickAtMost(2),
    ],
    [
      'a multi select under its least',
      one('multi_select', { choices: ['A', 'B', 'C'], options: { min: 2 } }),
      ['A'],
      words.pickAtLeast(2),
    ],
    [
      'a multi select with an empty Other',
      one('multi_select', { choices: ['A'], options: { other: true } }),
      { picked: [], other: ' ' },
      words.otherMissing,
    ],
    ['a ranking leaving one out', one('ranking', { choices: ['A', 'B', 'C'] }), ['A', 'B'], words.rankAll],
    ['a ranking naming one twice', one('ranking', { choices: ['A', 'B'] }), ['A', 'A'], words.rankAll],
    ['an address with neither street nor city', one('address'), { postcode: 'NW1' }, words.address],
    ['an address in a made up country', one('address'), { city: 'London', country: 'ZZ' }, words.country],
    ['a file that names no upload', one('file'), { fileId: '../../etc/passwd' }, words.fileInvalid],
    ['a signature that names no upload', one('signature'), 'drawn', words.signatureMissing],
    ['a required tick box left unticked', one('checkbox'), false, words.requiredCheckbox],
    ['a required consent sent as the word no', one('consent'), 'no', words.requiredCheckbox],
    ['a short answer with a line break', one('short_text'), 'one\ntwo', words.tooLong],
    ['a short answer past its limit', one('short_text'), 'a'.repeat(SHORT_ANSWER_MAX + 1), words.tooLong],
    ['a required answer of only spaces', one('short_text'), '   ', words.required],
    ['an answer that is an object where text belongs', one('short_text'), { toString: 'x' }, words.required],
  ];
  it.each(cases)('%s', (_name, form, raw, message) => {
    expect(messageFor(form, raw)).toBe(message);
  });

  it('never throws on any shape a forged body can carry, for any type', () => {
    const shapes: unknown[] = [
      null,
      0,
      -1,
      NaN,
      true,
      [],
      {},
      [[]],
      { picked: 'x' },
      { at: 5 },
      '\u0000',
      '😀'.repeat(5),
    ];
    const types = [
      'short_text',
      'long_text',
      'email',
      'phone',
      'website',
      'number',
      'date',
      'time',
      'datetime',
      'rating',
      'scale',
      'multi_select',
      'address',
      'file',
      'signature',
      'ranking',
      'country',
      'dropdown',
      'choice',
      'consent',
      'hidden',
    ] as const;
    for (const type of types) {
      for (const shape of shapes) {
        expect(
          () => checkAnswers(one(type, { choices: ['A'] }), { q: shape }),
          `${type} with ${JSON.stringify(shape)}`,
        ).not.toThrow();
      }
    }
  });
});

// Fixed on wip/forms-fixes (forms QA, 5 November 2026): `checkOne`'s number case drops every comma before checking, so "1,5" (one and a
// half, as most of Europe writes it) is filed as 15 and "1,2,3" as 123, silently. A comma is only a thousands
// separator between groups of three digits.
describe('a number answer keeps its meaning', () => {
  it('takes 1,500 as 1500', () => {
    expect(checkAnswers(one('number'), { q: '1,500' })).toEqual({ ok: true, answers: { q: '1500' } });
  });
  it('never turns a decimal comma or a list of numbers into a different number', () => {
    for (const typed of ['1,5', '1,2,3', '12,34']) {
      const checked = checkAnswers(one('number'), { q: typed });
      const kept = checked.ok ? checked.answers.q : undefined;
      expect(
        kept === undefined || kept === typed.replace(',', '.'),
        `${typed} was kept as ${JSON.stringify(kept)}`,
      ).toBe(true);
    }
  });
});

describe('long answers stop at their limit', () => {
  const long = one('long_text');

  it('takes a long answer of exactly its limit, line breaks and all', () => {
    const text = 'Line of text.\n'.repeat(140).slice(0, LONG_ANSWER_MAX);
    const checked = checkAnswers(long, { q: text });
    expect(checked.ok).toBe(true);
  });

  it('refuses 10,000 characters with the too long message, and keeps nothing of it', () => {
    const checked = checkAnswers(long, { q: 'x'.repeat(10_000) });
    expect(checked).toEqual({ ok: false, fields: { q: words.tooLong } });
  });

  it('counts the answer after trimming, so padding never pushes a fitting answer over', () => {
    expect(checkAnswers(long, { q: `   ${'y'.repeat(LONG_ANSWER_MAX)}   ` }).ok).toBe(true);
  });
});

describe('markup in an answer is kept as the characters it is', () => {
  it('takes script and HTML in text answers unchanged, for the screens to draw as text', () => {
    const form: CheckedForm = {
      language: 'en',
      questions: [
        { key: 'name', answerType: 'short_text', required: true },
        { key: 'about', answerType: 'long_text', required: false },
      ],
    };
    const name = '<img src=x onerror=alert(1)>';
    const about = '<script>alert("x")</script>\n<b>bold</b> & "quotes"';
    expect(checkAnswers(form, { name, about })).toEqual({ ok: true, answers: { name, about } });
  });
});

describe('a form holds exactly its 50 questions', () => {
  const question = (index: number): FormQuestion => ({
    id: `q${String(index)}`,
    key: `q${String(index)}`,
    label: `Question ${String(index)}`,
    answerType: index % 2 === 0 ? 'short_text' : 'long_text',
    required: false,
    update: 'fill',
  });
  const base = (count: number) => ({
    questions: [...defaultQuestions({}), ...Array.from({ length: count - 3 }, (_, index) => question(index + 1))],
    targets: {},
  });

  it('takes 50', () => {
    expect(FORM_QUESTIONS_MAX).toBe(50);
    expect(FormDocument.safeParse(base(50)).success).toBe(true);
  });

  it('refuses the 51st with a plain message', () => {
    const parsed = FormDocument.safeParse(base(51));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain('A form holds at most 50 questions.');
  });

  it('checks a full 50 question form’s answers in one pass', () => {
    const form: CheckedForm = {
      language: 'en',
      questions: Array.from({ length: 50 }, (_, index) => ({
        key: `q${String(index)}`,
        answerType: 'short_text' as const,
        required: true,
      })),
    };
    const answers = Object.fromEntries(form.questions.map((q) => [q.key, `Answer to ${q.key}`]));
    const checked = checkAnswers(form, answers);
    expect(checked.ok && Object.keys(checked.answers)).toHaveLength(50);
  });
});

describe('a rule left reading a deleted question', () => {
  const ruled: FormQuestion = {
    id: 'budget_detail',
    key: 'budget_detail',
    label: 'Tell us about the budget',
    answerType: 'long_text',
    required: true,
    update: 'fill',
    // `budget` was deleted from the form; the rule still names it.
    showWhen: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Over $10k' }] },
  };

  it('never strands a visitor: the question it guards stays hidden and is not required', () => {
    const form: CheckedForm = {
      language: 'en',
      questions: [
        { key: 'name', answerType: 'short_text', required: true },
        { key: ruled.key, answerType: ruled.answerType, required: true, showWhen: ruled.showWhen },
      ],
    };
    expect(checkAnswers(form, { name: 'Ada' })).toEqual({ ok: true, answers: { name: 'Ada' } });
  });

  it('is refused at publish, naming what is wrong', () => {
    const document = FormDocument.parse({
      questions: [...defaultQuestions({ emailAttributeId: EMAIL }), ruled],
      targets: { main: { objectId: PEOPLE, matchAttributeId: EMAIL } },
    });
    const attributes = new Map<string, PublishAttribute>([
      [EMAIL, { id: EMAIL, title: 'Email addresses', type: 'email', objectName: 'Person', canWrite: true }],
    ]);
    const problem = publishProblem({ name: 'Contact us', slug: 'contact-us', document, attributes });
    expect(problem?.message).toMatch(/no longer on the form/);
  });
});

describe('every spreadsheet formula start is guarded in a CSV cell', () => {
  const attacks = [
    '=HYPERLINK("http://evil.example","Click")',
    "=cmd|' /C calc'!A0",
    '+1+1',
    '-2+3',
    '@SUM(A1:A2)',
    '\t=1+1',
    '\r=1+1',
  ];
  it.each(attacks)('guards %j and reads it back unchanged', (attack) => {
    const cell = csvCell(attack);
    // The cell, once a spreadsheet takes the quoting off, starts with the apostrophe.
    const unquoted = cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell;
    expect(unquoted.startsWith("'")).toBe(true);
    expect(unguardCell(unquoted)).toBe(attack);
  });

  it('guards each formula cell in a whole line, and leaves plain text alone', () => {
    expect(csvLine(['=1+1', 'Ada', '-5', 'a,b'])).toBe(`'=1+1,Ada,'-5,"a,b"\r\n`);
  });
});

describe('an upload can’t pass as another type', () => {
  const type = (contentType: string) => {
    const found = uploadTypeOf(contentType);
    if (found === undefined) throw new Error(`No upload type ${contentType}.`);
    return found;
  };
  const bytes = (text: string) => new TextEncoder().encode(text);

  it('refuses SVG and HTML whatever they are called', () => {
    expect(uploadTypeOf('image/svg+xml')).toBeUndefined();
    expect(uploadTypeOf('text/html')).toBeUndefined();
    expect(uploadTypeOf('application/xhtml+xml')).toBeUndefined();
    expect(uploadTypeOf('application/javascript')).toBeUndefined();
    expect(FORM_UPLOAD_TYPES.flatMap((t) => t.extensions)).not.toContain('svg');
  });

  it('refuses an SVG or a script declared as an image or a PDF, by its bytes', () => {
    const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect(matchesContent(type('image/png'), svg)).toBe(false);
    expect(matchesContent(type('image/jpeg'), svg)).toBe(false);
    expect(matchesContent(type('application/pdf'), bytes('<script>alert(1)</script>%PDF-1.7'))).toBe(false);
    expect(
      matchesContent(
        type('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        bytes('MZ\u0090\u0000'),
      ),
    ).toBe(false);
  });

  it('gives a page or a program renamed as a text file the text type’s own extension', () => {
    expect(sanitiseFileName('evil.html', type('text/plain'))).toBe('evil.txt');
    expect(sanitiseFileName('invoice.pdf.exe', type('application/pdf'))).toBe('invoice.pdf.pdf');
    // A right to left override would draw "exe.pdf" as "fdp.exe": it is taken out.
    expect(sanitiseFileName('cv‮fdp.exe', type('application/pdf'))).toBe('cvfdp.pdf');
    expect(sanitiseFileName('..\\..\\windows\\system32\\a.pdf', type('application/pdf'))).toBe('a.pdf');
  });
});
