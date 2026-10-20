// The spam checker's pure parts (spec 0023, AC-584, the spam follow-up): the
// bot signals and their precedence, the content score's weights and bands,
// and the gibberish reading of names, which must never judge a real name.
import { describe, expect, it } from 'vitest';
import { judgeSubmission, looksLikeGibberish, scoreContent, SPAM_SCORE, type TicketVerdict } from './spam.ts';

const questions = [
  { key: 'name', answerType: 'short_text' as const },
  { key: 'email', answerType: 'email' as const },
  { key: 'message', answerType: 'long_text' as const },
];
const settings = { minFillMs: 2_000, scoreThreshold: 0.3 };
const valid: TicketVerdict = { kind: 'valid', elapsedMs: 9_000 };
const clean = { score: 0, signals: [] };

const score = (answers: Record<string, unknown>, extra: { repeats?: number; ticket?: TicketVerdict } = {}) =>
  scoreContent({ questions, answers, repeats: extra.repeats ?? 0, ticket: extra.ticket ?? valid });

describe('judgeSubmission', () => {
  it('makes spam of any one bot signal, and passes a clean one', () => {
    const base = { ticket: valid, captcha: { kind: 'off' } as const, settings, content: clean };
    expect(judgeSubmission(base)).toEqual({ verdict: 'passed', signals: [], score: 0 });
    expect(judgeSubmission({ ...base, honeypot: 'https://x.example' }).signals).toEqual(['honeypot']);
    expect(judgeSubmission({ ...base, honeypot: '  ' }).verdict).toBe('passed');
    expect(judgeSubmission({ ...base, captcha: { kind: 'score', score: 0.1 } }).signals).toEqual(['captcha_low_score']);
    expect(judgeSubmission({ ...base, captcha: { kind: 'missing' } }).verdict).toBe('spam');
    expect(judgeSubmission({ ...base, captcha: { kind: 'unavailable' } })).toEqual({
      verdict: 'unchecked',
      signals: ['captcha_unavailable'],
      score: 0,
    });
  });

  it('times the fill on the server’s ticket when there is one, else on the page’s fillMs, else not at all', () => {
    const base = { captcha: { kind: 'off' } as const, settings, content: clean };
    const fast: TicketVerdict = { kind: 'valid', elapsedMs: 900 };
    expect(judgeSubmission({ ...base, ticket: fast, fillMs: 60_000 }).signals).toEqual(['too_fast']);
    expect(judgeSubmission({ ...base, ticket: valid, fillMs: 10 }).verdict).toBe('passed');
    expect(judgeSubmission({ ...base, ticket: { kind: 'missing' }, fillMs: 1_500 }).signals).toEqual(['too_fast']);
    expect(judgeSubmission({ ...base, ticket: { kind: 'missing' } }).verdict).toBe('passed');
  });

  it('bands the content score: review from reviewAt, spam from spamAt', () => {
    const base = { ticket: valid, captcha: { kind: 'off' } as const, settings };
    const at = (points: number) => judgeSubmission({ ...base, content: { score: points, signals: ['x'] } }).verdict;
    expect(at(SPAM_SCORE.reviewAt - 1)).toBe('passed');
    expect(at(SPAM_SCORE.reviewAt)).toBe('review');
    expect(at(SPAM_SCORE.spamAt - 1)).toBe('review');
    expect(at(SPAM_SCORE.spamAt)).toBe('spam');
  });
});

describe('scoreContent', () => {
  it('scores nothing in an ordinary enquiry, even with one link', () => {
    expect(
      score({ name: 'Ada Lovelace', email: 'ada@example.com', message: 'See https://acme.example for our site.' }),
    ).toEqual(clean);
  });

  it('weighs links, markup, a link in the name and a disposable domain', () => {
    const many = Array.from({ length: 5 }, (_, i) => `https://s${String(i)}.example`).join(' ');
    expect(score({ name: 'Ada', message: many })).toEqual({ score: 4, signals: ['many_links'] });
    expect(score({ name: 'Ada', message: 'https://a.example http://b.example www.c.example' }).signals).toEqual([
      'links',
    ]);
    expect(score({ name: 'Ada', message: '[url=http://x.example]cheap[/url]' })).toEqual({
      score: 3,
      signals: ['markup_links'],
    });
    expect(score({ name: 'Visit www.pills.example', email: 'ada@example.com' }).signals).toEqual(['link_in_name']);
    expect(score({ name: 'Ada', email: 'ada@Mailinator.com' }).signals).toEqual(['disposable_email']);
  });

  it('weighs repeats, and timing it couldn’t measure or a ticket it couldn’t trust', () => {
    expect(score({ name: 'Ada' }, { repeats: 1 })).toEqual({ score: 2, signals: ['repeated'] });
    expect(score({ name: 'Ada' }, { repeats: 3 })).toEqual({ score: 4, signals: ['repeated'] });
    expect(score({ name: 'Ada' }, { ticket: { kind: 'missing' } })).toEqual({ score: 3, signals: ['no_timing'] });
    expect(
      scoreContent({ questions, answers: { name: 'Ada' }, repeats: 0, ticket: { kind: 'missing' }, signed: true }),
    ).toEqual(clean);
    expect(
      scoreContent({ questions, answers: { name: 'Ada' }, repeats: 0, ticket: valid, emailOverLimit: true }),
    ).toEqual({ score: 3, signals: ['email_limit'] });
    expect(scoreContent({ questions, answers: {}, repeats: 0, ticket: { kind: 'expired' }, fillMs: 5_000 })).toEqual(
      clean,
    );
    expect(score({ name: 'Ada' }, { ticket: { kind: 'reused' } })).toEqual({ score: 3, signals: ['ticket_reused'] });
  });
});

describe('the markup check on hostile input', () => {
  it('stays linear: 20 answers of 2,000 characters of unclosed tags score in well under a second', () => {
    const hostile = '<a '.repeat(667);
    const answers = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`q${String(i)}`, hostile]));
    const started = performance.now();
    scoreContent({ questions, answers, repeats: 0, ticket: valid });
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('looksLikeGibberish', () => {
  it('flags keyboard mashing', () => {
    for (const name of ['Xkcdqwrt', 'xKjfTqLp', 'Bcdfghj Smith', 'asdfghjkl'])
      expect(looksLikeGibberish(name)).toBe(true);
  });

  it('never flags real names, short names or other scripts', () => {
    for (const name of [
      'Ada Lovelace',
      'McDonald',
      'DeAndre Jordan',
      'MacKenzie',
      'Nguyen',
      'Ng',
      'Lynn Wyld',
      'Schwarzkopf',
      'O’Brien',
      'Jean-Luc Picard',
      'José Álvarez',
      'राहुल शर्मा',
      '李小龍',
      'Łukasz Brzęczyszczykiewicz',
    ]) {
      expect(looksLikeGibberish(name), name).toBe(false);
    }
  });
});
