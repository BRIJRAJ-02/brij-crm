// Why a submission sits in Spam or Needs review, in one plain line (forms fix a8): the panel said nothing, so a
// real enquiry caught by mistake looked the same as a bot's. Pure, so it tests in Node.
import { strings } from './strings.ts';

/** The first signal that explains a spam or held submission, as one sentence; a held one with none says why it waits. */
export function spamReason(signals: readonly string[], state: 'spam' | 'needs_review'): string {
  for (const signal of signals) {
    if (signal === 'honeypot' || signal === 'too_fast' || signal.startsWith('ticket_') || signal === 'no_timing') {
      return strings.spamWhy.bot;
    }
    if (signal.startsWith('captcha_') && signal !== 'captcha_unavailable') return strings.spamWhy.captcha;
    if (signal === 'markup_links' || signal === 'many_links' || signal === 'links' || signal === 'link_in_name') {
      return strings.spamWhy.links;
    }
    if (signal === 'gibberish_name') return strings.spamWhy.name;
    if (signal === 'disposable_email') return strings.spamWhy.email;
    if (signal === 'repeated') return strings.spamWhy.repeated;
    if (signal === 'email_limit') return strings.spamWhy.limit;
  }
  return state === 'needs_review' ? strings.spamWhy.doubtful : strings.spamWhy.marked;
}
