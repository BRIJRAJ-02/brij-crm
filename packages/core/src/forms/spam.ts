// The spam checker for public submissions (spec 0023, AC-583 to AC-586,
// 0023-experience.md, Bots and abuse, adjusted), as pure functions: what the
// submit path judges once the API has checked the limits, the fill ticket and
// reCAPTCHA. Two tiers. The bot signals are certain and silent: a filled
// honeypot, a submit faster than a person types (on the server's clock when a
// ticket came, else the page's own `fillMs`), a reCAPTCHA token missing,
// refused or scoring low (when reCAPTCHA is on). Any one is spam. Then the
// content is scored: links, markup, a disposable email domain, a name that
// reads as gibberish, the same answers sent again, and timing that couldn't be
// measured. At or past `SPAM_SCORE.spamAt` it is spam; from `reviewAt` it waits
// in Needs review for a member (`submissions.resolve`). Everything is the
// conservative reading: no single doubtful sign makes spam on its own.
import type { PublicQuestion } from '@crm/contracts';

/**
 * What the reCAPTCHA check found, when reCAPTCHA is on: a score, no token, a
 * refused token, Google not answering; `off` when no keys are set (the
 * default), so the honeypot, timing and limits decide alone.
 */
export type CaptchaVerdict =
  | { readonly kind: 'off' }
  | { readonly kind: 'score'; readonly score: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' };

/**
 * What the API made of the fill ticket: how long ago the server issued it,
 * or that none came, it was not ours (or not for this address), it was over a
 * day old, or it was spent (sent with more submits than one page makes).
 */
export type TicketVerdict =
  | { readonly kind: 'valid'; readonly elapsedMs: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'reused' };

/** The content score's bands: spam at or past `spamAt`, Needs review from `reviewAt`. */
export const SPAM_SCORE = { reviewAt: 3, spamAt: 6 } as const;

/** How far back a submission with the same answers counts as a repeat. */
export const REPEAT_WINDOW_HOURS = 24;

/**
 * Throwaway inbox domains: a short pinned seed of the most common, until a
 * maintained list is chosen (spec 0023 Follow-up, pending owner confirmation).
 * A weak sign only: it never makes spam alone.
 */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  '20minutemail.com',
  'discard.email',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamailblock.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'mohmal.com',
  'sharklasers.com',
  'spamgourmet.com',
  'temp-mail.org',
  'tempmail.com',
  'tempmailo.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);

/** What the bot checks and the content score decided, and why. */
export interface SpamJudgement {
  /** `passed` goes on to processing; `unchecked` too (reCAPTCHA couldn't be asked); `review` waits; `spam` stops. */
  readonly verdict: 'passed' | 'spam' | 'unchecked' | 'review';
  /** Every signal that counted, bot signals first. */
  readonly signals: readonly string[];
  /** The content score (0 when only bot signals decided). */
  readonly score: number;
}

/** What judging a submission reads. */
export interface JudgeInput {
  /** The honeypot's value, as sent. */
  readonly honeypot?: string;
  /** The page's own fill time, advisory: used only when no valid ticket came. */
  readonly fillMs?: number;
  readonly ticket: TicketVerdict;
  readonly captcha: CaptchaVerdict;
  readonly settings: { readonly minFillMs: number; readonly scoreThreshold: number };
  /** The content's own signals and score (`scoreContent`). */
  readonly content: ContentScore;
}

/** The content's doubtful signs and their weight. */
export interface ContentScore {
  readonly score: number;
  readonly signals: readonly string[];
}

const LINK = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]/giu;
const MARKUP = /<\s*a\s[^>]*href|\[url[=\]]|\[link[=\]]/iu;
const NAME_KEY = /(^|_)name$/u;

/** How many links a text holds. */
function linkCount(text: string): number {
  return text.match(LINK)?.length ?? 0;
}

/**
 * Whether a name reads as keyboard mashing, judged only on plain Latin
 * letters (any other script is never judged): a word of 5 or more letters
 * with no vowel, 6 consonants in a row, or a word of 6 or more whose case
 * flips 4 or more times (`xKjfTqLp`; `McDonald` and `DeAndre` flip 3).
 */
export function looksLikeGibberish(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === '' || /[^\p{Script=Latin}\s.'’-]/u.test(trimmed)) return false;
  if (!/^[A-Za-z\s.'’-]+$/u.test(trimmed)) return false;
  return trimmed.split(/[\s.'’-]+/u).some((word) => {
    if (word.length >= 5 && !/[aeiouy]/iu.test(word)) return true;
    if (/[b-df-hj-np-tv-xz]{6,}/iu.test(word)) return true;
    let flips = 0;
    for (let index = 1; index < word.length; index += 1) {
      const before = word.charAt(index - 1);
      const here = word.charAt(index);
      if ((before === before.toUpperCase()) !== (here === here.toUpperCase())) flips += 1;
    }
    return flips >= 4 && word.length >= 6;
  });
}

/** The domain of an email answer, lowercased, or undefined. */
function domainOf(email: string): string | undefined {
  const at = email.lastIndexOf('@');
  return at < 0
    ? undefined
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/**
 * Scores the content of checked answers. `repeats` is how many submissions
 * to the same form in the last day carried exactly these answers. Weights:
 * markup links 3; links 1 for 2, 2 for 3 or 4, 4 for 5 or more; a link in a
 * name 3; a disposable email domain 2; a gibberish name 2; one or two repeats
 * 2, three or more 4; no measurable fill time (no ticket and no `fillMs`) 1;
 * a ticket that wasn't ours, or was spent, 3.
 */
export function scoreContent(input: {
  readonly questions: readonly Pick<PublicQuestion, 'key' | 'answerType'>[];
  readonly answers: Readonly<Record<string, unknown>>;
  readonly repeats: number;
  readonly ticket: TicketVerdict;
  readonly fillMs?: number;
  readonly disposable?: ReadonlySet<string>;
}): ContentScore {
  const disposable = input.disposable ?? DISPOSABLE_DOMAINS;
  const signals: [string, number][] = [];
  const texts = Object.values(input.answers).filter((value): value is string => typeof value === 'string');
  const all = texts.join('\n');
  if (MARKUP.test(all)) signals.push(['markup_links', 3]);
  const links = texts.reduce((sum, text) => sum + linkCount(text), 0);
  if (links >= 5) signals.push(['many_links', 4]);
  else if (links >= 3) signals.push(['links', 2]);
  else if (links === 2) signals.push(['links', 1]);
  const names = input.questions.filter(
    (question) => question.answerType === 'short_text' && NAME_KEY.test(question.key),
  );
  const nameValues = names.flatMap((question) => {
    const value = input.answers[question.key];
    return typeof value === 'string' ? [value] : [];
  });
  if (nameValues.some((value) => linkCount(value) > 0 || /\.[a-z]{2,}\//iu.test(value))) {
    signals.push(['link_in_name', 3]);
  } else if (nameValues.some(looksLikeGibberish)) signals.push(['gibberish_name', 2]);
  const emails = input.questions.flatMap((question) => {
    const value = input.answers[question.key];
    return question.answerType === 'email' && typeof value === 'string' ? [value] : [];
  });
  if (emails.some((email) => disposable.has(domainOf(email) ?? ''))) signals.push(['disposable_email', 2]);
  if (input.repeats >= 3) signals.push(['repeated', 4]);
  else if (input.repeats >= 1) signals.push(['repeated', 2]);
  if (input.ticket.kind === 'invalid' || input.ticket.kind === 'reused')
    signals.push([`ticket_${input.ticket.kind}`, 3]);
  else if (input.ticket.kind !== 'valid' && input.fillMs === undefined) signals.push(['no_timing', 1]);
  return {
    score: signals.reduce((sum, [, weight]) => sum + weight, 0),
    signals: signals.map(([signal]) => signal),
  };
}

/**
 * Judges one submission: bot signals first (any one is spam), then the
 * content score's bands, then reCAPTCHA not answering (`unchecked`, processed
 * as usual and marked). The fill time is the server's when a valid ticket
 * came; otherwise the page's `fillMs` when it sent one; otherwise unmeasured
 * (a weak content sign, never spam on its own).
 */
export function judgeSubmission(input: JudgeInput): SpamJudgement {
  const bot: string[] = [];
  if (input.honeypot !== undefined && input.honeypot.trim() !== '') bot.push('honeypot');
  const fill = input.ticket.kind === 'valid' ? input.ticket.elapsedMs : input.fillMs;
  if (fill !== undefined && fill < input.settings.minFillMs) bot.push('too_fast');
  const { captcha } = input;
  if (captcha.kind === 'missing') bot.push('captcha_missing');
  if (captcha.kind === 'invalid') bot.push('captcha_invalid');
  if (captcha.kind === 'score' && captcha.score < input.settings.scoreThreshold) bot.push('captcha_low_score');
  const { score, signals } = input.content;
  if (bot.length > 0) return { verdict: 'spam', signals: [...bot, ...signals], score };
  if (score >= SPAM_SCORE.spamAt) return { verdict: 'spam', signals, score };
  if (score >= SPAM_SCORE.reviewAt) return { verdict: 'review', signals, score };
  if (captcha.kind === 'unavailable')
    return { verdict: 'unchecked', signals: [...signals, 'captcha_unavailable'], score };
  return { verdict: 'passed', signals, score };
}
