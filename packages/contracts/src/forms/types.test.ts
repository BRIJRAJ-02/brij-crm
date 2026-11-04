// Spec 0063's first batch of answer types (AC-6307, AC-6309, AC-6310): each one's check and canonical shape, the
// hidden default, the 50 question limit, and every shape's words.
import { describe, expect, it } from 'vitest';
import { FILES_ONTO, FORM_QUESTIONS_MAX } from './answer-types.ts';
import { answerWords } from './answer-words.ts';
import { checkAnswers, type CheckedForm } from './check.ts';
import { FormDocument } from './document.ts';

const form = (question: CheckedForm['questions'][number]): CheckedForm => ({ language: 'en', questions: [question] });
const one = (question: CheckedForm['questions'][number], value: unknown) =>
  checkAnswers(form(question), { [question.key]: value });

describe('the new answer types (spec 0063, AC-6307)', () => {
  it('takes a real date within the range, and refuses one outside it in plain words', () => {
    const date = { key: 'start', answerType: 'date', required: true, options: { earliest: '2026-11-01' } } as const;
    expect(one(date, '2026-11-02')).toEqual({ ok: true, answers: { start: '2026-11-02' } });
    expect(one(date, '2026-02-30')).toEqual({ ok: false, fields: { start: 'Enter a date.' } });
    expect(one(date, '2026-10-30')).toEqual({ ok: false, fields: { start: 'Pick 2026-11-01 or later.' } });
  });

  it('writes a time as HH:MM', () => {
    const time = { key: 'slot', answerType: 'time', required: true } as const;
    expect(one(time, '9:05')).toEqual({ ok: true, answers: { slot: '09:05' } });
    expect(one(time, '24:00').ok).toBe(false);
  });

  it('keeps a date and time as its moment in UTC and the zone it was given in, and needs an offset', () => {
    const datetime = { key: 'call', answerType: 'datetime', required: true } as const;
    expect(one(datetime, { at: '2026-11-02T14:30:00+05:30', timeZone: 'Asia/Kolkata' })).toEqual({
      ok: true,
      answers: { call: { at: '2026-11-02T09:00:00.000Z', timeZone: 'Asia/Kolkata' } },
    });
    expect(one(datetime, { at: '2026-11-02T14:30', timeZone: 'Asia/Kolkata' }).ok).toBe(false);
    expect(one(datetime, { at: '2026-11-02T14:30:00Z', timeZone: 'Nowhere/Land' }).ok).toBe(false);
  });

  it('takes a rating from 1 to 5 and a scale within its own ends', () => {
    expect(one({ key: 'fit', answerType: 'rating', required: true }, '4')).toEqual({ ok: true, answers: { fit: 4 } });
    expect(one({ key: 'fit', answerType: 'rating', required: true }, 6).ok).toBe(false);
    const nps = { key: 'nps', answerType: 'scale', required: true } as const;
    expect(one(nps, 0)).toEqual({ ok: true, answers: { nps: 0 } });
    expect(one({ ...nps, options: { from: 1, to: 5 } }, 0).ok).toBe(false);
  });

  it('takes a multi select’s picks by words or key, Other’s words, and holds its least and most', () => {
    const teams: CheckedForm['questions'][number] = {
      key: 'teams',
      answerType: 'multi_select',
      required: true,
      choices: ['Sales', 'Support'],
      choiceKeys: ['sales', 'support'],
      options: { other: true, min: 1, max: 2 },
    };
    expect(one(teams, ['sales', 'Support'])).toEqual({
      ok: true,
      answers: { teams: { picked: ['Sales', 'Support'] } },
    });
    expect(one(teams, { picked: ['Sales'], other: 'Billing' })).toEqual({
      ok: true,
      answers: { teams: { picked: ['Sales'], other: 'Billing' } },
    });
    expect(one(teams, { picked: ['Sales'], other: ' ' })).toEqual({
      ok: false,
      fields: { teams: 'Say what Other is, or untick it.' },
    });
    expect(one(teams, { picked: ['Sales', 'Support'], other: 'Billing' })).toEqual({
      ok: false,
      fields: { teams: 'Pick at most 2.' },
    });
    expect(one(teams, { picked: [] })).toEqual({ ok: false, fields: { teams: 'Answer this question.' } });
    expect(one(teams, ['Marketing']).ok).toBe(false);
  });

  it('takes an address with at least its street or city, the country as its code', () => {
    const office = { key: 'office', answerType: 'address', required: true } as const;
    expect(one(office, { line1: ' 1 Main St ', country: 'gb' })).toEqual({
      ok: true,
      answers: { office: { line1: '1 Main St', country: 'GB' } },
    });
    expect(one(office, { postcode: 'LS1' }).ok).toBe(false);
    expect(one(office, { line1: '', city: '' })).toEqual({ ok: false, fields: { office: 'Answer this question.' } });
  });

  it('gives a hidden question the link’s value, else its default, and never refuses it for being empty', () => {
    const source = {
      key: 'utm_campaign',
      answerType: 'hidden',
      required: true,
      options: { default: 'direct' },
    } as const;
    expect(one(source, 'spring')).toEqual({ ok: true, answers: { utm_campaign: 'spring' } });
    expect(one(source, undefined)).toEqual({ ok: true, answers: { utm_campaign: 'direct' } });
    expect(one({ ...source, options: {} }, undefined)).toEqual({ ok: true, answers: {} });
  });

  it('files each new type onto the attribute types the spec names', () => {
    expect(FILES_ONTO.date).toEqual(['date']);
    expect(FILES_ONTO.datetime).toEqual(['timestamp']);
    expect(FILES_ONTO.rating).toEqual(['rating', 'number']);
    expect(FILES_ONTO.multi_select).toEqual(['select']);
    expect(FILES_ONTO.address).toEqual(['location']);
    expect(FILES_ONTO.hidden).toEqual(['text', 'select', 'number']);
  });
});

describe('a form’s limits (AC-6310)', () => {
  const question = (index: number) => ({
    id: `q${String(index)}`,
    key: `q${String(index)}`,
    label: 'Q',
    answerType: 'short_text' as const,
    required: false,
  });

  it('holds 50 questions and refuses a 51st in one sentence', () => {
    expect(FORM_QUESTIONS_MAX).toBe(50);
    const fifty = Array.from({ length: 50 }, (_, index) => question(index));
    expect(FormDocument.safeParse({ questions: fifty, targets: {} }).success).toBe(true);
    const issues = FormDocument.safeParse({ questions: [...fifty, question(50)], targets: {} }).error?.issues;
    expect(issues?.map((issue) => issue.message)).toEqual(['A form holds at most 50 questions.']);
  });

  it('refuses a date range that ends before it starts', () => {
    const issues = FormDocument.safeParse({
      questions: [{ ...question(1), answerType: 'date', options: { earliest: '2026-12-01', latest: '2026-11-01' } }],
      targets: {},
    }).error?.issues;
    expect(issues?.map((issue) => issue.message)).toEqual(['The latest day comes before the earliest.']);
  });
});

describe('answerWords', () => {
  it('reads a consent as Agreed or Not agreed, never Yes or No (forms fix b9)', () => {
    expect(answerWords(true, { answerType: 'consent' })).toBe('Agreed');
    expect(answerWords(false, { answerType: 'consent' })).toBe('Not agreed');
    expect(answerWords(true, { answerType: 'checkbox' })).toBe('Yes');
  });

  it('reads every shape as words', () => {
    expect(answerWords({ picked: ['Sales', 'Support'], other: 'Billing' })).toBe('Sales, Support, Other: Billing');
    expect(answerWords({ line1: '1 Main St', city: 'Leeds', country: 'GB' })).toBe('1 Main St, Leeds, GB');
    expect(answerWords({ at: '2026-11-02T09:00:00.000Z', timeZone: 'Asia/Kolkata' })).toBe(
      '2 Nov 2026, 14:30 (Asia/Kolkata)',
    );
    expect(answerWords(4)).toBe('4');
    expect(answerWords(true, { yes: 'Ja' })).toBe('Ja');
    expect(answerWords({ number: '+447700900000', country: 'GB' })).toBe('+447700900000');
  });
});

describe('batch two: signature and ranking (spec 0063, AC-6307, AC-6310)', () => {
  const ranking: CheckedForm['questions'][number] = {
    key: 'tools',
    answerType: 'ranking',
    required: true,
    choices: ['Slack', 'Notion', 'Linear'],
    choiceKeys: ['slack', 'notion', 'linear'],
  };

  it('takes every choice once in the visitor’s order, by words or by key, and refuses anything less', () => {
    expect(one(ranking, ['Linear', 'Slack', 'Notion'])).toEqual({
      ok: true,
      answers: { tools: ['Linear', 'Slack', 'Notion'] },
    });
    expect(one(ranking, ['notion', 'linear', 'slack'])).toEqual({
      ok: true,
      answers: { tools: ['Notion', 'Linear', 'Slack'] },
    });
    const refusal = { ok: false, fields: { tools: 'Put every choice in your order.' } };
    expect(one(ranking, ['Linear', 'Slack'])).toEqual(refusal);
    expect(one(ranking, ['Linear', 'Linear', 'Slack'])).toEqual(refusal);
    expect(one(ranking, ['Linear', 'Slack', 'Jira'])).toEqual(refusal);
    expect(one(ranking, 'Linear')).toEqual(refusal);
    // A blank choice's key names no choice the visitor saw.
    const blank: CheckedForm['questions'][number] = {
      ...ranking,
      choices: ['Slack', '', 'Linear'],
      choiceKeys: ['slack', 'gap', 'linear'],
    };
    expect(one(blank, ['gap', 'Slack'])).toEqual(refusal);
  });

  it('asks a required ranking left untouched, and leaves an optional one out', () => {
    expect(one(ranking, undefined)).toEqual({ ok: false, fields: { tools: 'Answer this question.' } });
    expect(one({ ...ranking, required: false }, undefined)).toEqual({ ok: true, answers: {} });
  });

  it('takes a signature as the upload it names, and refuses anything else', () => {
    const signature = { key: 'sign', answerType: 'signature', required: true } as const;
    const fileId = '01a19070-abed-72aa-bda5-e28af82c31e3';
    expect(one(signature, { fileId })).toEqual({ ok: true, answers: { sign: { fileId } } });
    expect(one(signature, { fileId: 'not-an-id' })).toEqual({
      ok: false,
      fields: { sign: 'Sign here, or type your name instead.' },
    });
    expect(one(signature, undefined)).toEqual({ ok: false, fields: { sign: 'Answer this question.' } });
  });

  it('files a signature onto a file and a ranking onto text', () => {
    expect(FILES_ONTO.signature).toEqual(['file']);
    expect(FILES_ONTO.ranking).toEqual(['text', 'long_text']);
  });

  it('refuses a second signature question in one sentence', () => {
    const signature = (index: number) => ({
      id: `s${String(index)}`,
      key: `s${String(index)}`,
      label: 'Sign',
      answerType: 'signature' as const,
      required: false,
    });
    expect(FormDocument.safeParse({ questions: [signature(1)], targets: {} }).success).toBe(true);
    const issues = FormDocument.safeParse({ questions: [signature(1), signature(2)], targets: {} }).error?.issues;
    expect(issues?.map((issue) => issue.message)).toEqual([
      'A form can ask for one signature. Remove the other signature question first.',
    ]);
  });

  it('reads a ranking as its order and a signature as signed', () => {
    expect(answerWords(['Linear', 'Slack'], { answerType: 'ranking' })).toBe('1. Linear, 2. Slack');
    expect(answerWords({ fileId: 'x', name: 'signature.png' }, { answerType: 'signature' })).toBe('Signed');
  });
});
