// A comment being written (spec 0038, AC-1154): the text as the person sees it,
// each mention shown as "@Name", and where those mentions sit. Sent, each
// mention becomes its `<@member-uuid>` token, so a rename never rewrites a
// comment. A mention is whole or gone: an edit that touches any character of
// "@Name" takes the whole of it out. Pure functions, so the composer and its
// tests share them.
import { bodySegments, mentionToken } from '@crm/contracts/mentions';

/** One mention in a draft: the member, and where "@Name" sits in the text. */
export interface DraftMention {
  readonly memberId: string;
  readonly start: number;
  readonly end: number;
}

/** A comment being written: what shows, and its mentions in order. */
export interface Draft {
  readonly text: string;
  readonly mentions: readonly DraftMention[];
}

/** An empty draft. */
export const EMPTY_DRAFT: Draft = { text: '', mentions: [] };

/** A stored comment's text as a draft to edit, each token shown as "@Name" (a former member's by `nameOf`). */
export function draftOf(body: string, nameOf: (memberId: string) => string): Draft {
  let text = '';
  const mentions: DraftMention[] = [];
  for (const segment of bodySegments(body)) {
    if (segment.kind === 'text') {
      text += segment.text;
      continue;
    }
    const shown = `@${nameOf(segment.memberId)}`;
    mentions.push({ memberId: segment.memberId, start: text.length, end: text.length + shown.length });
    text += shown;
  }
  return { text, mentions };
}

/** The draft as the text sent and stored: each mention as its token. */
export function bodyOf(draft: Draft): string {
  let out = '';
  let at = 0;
  for (const mention of draft.mentions) {
    out += draft.text.slice(at, mention.start) + mentionToken(mention.memberId);
    at = mention.end;
  }
  return out + draft.text.slice(at);
}

/**
 * The draft after the text became `next` (one edit: typing, a paste, a
 * delete): mentions before the edit stay, those after it move with it, and
 * one the edit touched goes whole, with whatever was left of its "@Name".
 * Answers the draft and where the caret belongs when text was taken out.
 */
export function edited(before: Draft, next: string): { readonly draft: Draft; readonly caret?: number } {
  const old = before.text;
  let prefix = 0;
  const shortest = Math.min(old.length, next.length);
  while (prefix < shortest && old[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    old[old.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const changedEnd = old.length - suffix;
  const inserted = next.length - prefix - suffix;
  const delta = next.length - old.length;
  // A pure insertion touches a mention only strictly inside it; a removal or a replacement any overlap.
  const touches = (mention: DraftMention) =>
    changedEnd === prefix
      ? mention.start < prefix && prefix < mention.end
      : mention.start < changedEnd && mention.end > prefix;
  let text = next;
  const kept: DraftMention[] = [];
  // What is left of each touched mention, in `next`'s positions, taken out from the end first.
  const cuts: { start: number; end: number }[] = [];
  for (const mention of before.mentions) {
    if (mention.end <= prefix) {
      kept.push(mention);
    } else if (mention.start >= changedEnd && !touches(mention)) {
      kept.push({ ...mention, start: mention.start + delta, end: mention.end + delta });
    } else if (touches(mention)) {
      if (mention.start < prefix) cuts.push({ start: mention.start, end: prefix });
      if (mention.end > changedEnd) {
        cuts.push({ start: changedEnd + delta, end: mention.end + delta });
      }
    } else {
      kept.push(mention);
    }
  }
  if (cuts.length === 0) return { draft: { text, mentions: kept } };
  cuts.sort((a, b) => b.start - a.start);
  let caret = prefix + inserted;
  const shifted = kept.map((mention) => ({ ...mention }));
  for (const cut of cuts) {
    const length = cut.end - cut.start;
    text = text.slice(0, cut.start) + text.slice(cut.end);
    if (caret > cut.start) caret -= Math.min(length, caret - cut.start);
    for (const mention of shifted) {
      if (mention.start >= cut.end) {
        mention.start -= length;
        mention.end -= length;
      }
    }
  }
  return { draft: { text, mentions: shifted }, caret };
}

/** The `@` being typed before the caret: where it starts and what follows it, while the picker should show. */
export function queryAt(draft: Draft, caret: number): { readonly start: number; readonly query: string } | undefined {
  if (draft.mentions.some((mention) => caret > mention.start && caret <= mention.end)) return undefined;
  const before = draft.text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return undefined;
  // At the start of the text or after a space (AC-1154), never inside a word such as an email address.
  if (at > 0 && !/\s/.test(before[at - 1] ?? '')) return undefined;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\r\n]/.test(query) || /\s\s/.test(query) || query.startsWith(' ')) return undefined;
  if (draft.mentions.some((mention) => mention.start <= at && at < mention.end)) return undefined;
  return { start: at, query };
}

/** The draft with "@Name " in place of the `@query` from `start` to the caret. Answers the caret after it. */
export function picked(
  draft: Draft,
  start: number,
  caret: number,
  member: { readonly id: string; readonly name: string },
): { readonly draft: Draft; readonly caret: number } {
  const shown = `@${member.name}`;
  const text = `${draft.text.slice(0, start)}${shown} ${draft.text.slice(caret)}`;
  const delta = shown.length + 1 - (caret - start);
  const mentions = [
    ...draft.mentions
      .filter((mention) => mention.end <= start)
      .concat({ memberId: member.id, start, end: start + shown.length }),
    ...draft.mentions
      .filter((mention) => mention.start >= caret)
      .map((mention) => ({ ...mention, start: mention.start + delta, end: mention.end + delta })),
  ];
  return { draft: { text, mentions }, caret: start + shown.length + 1 };
}

/** Members matching a query by name or email, those whose name starts with it first, at most `max`. */
export function matchingMembers<M extends { readonly name: string; readonly email?: string }>(
  members: readonly M[],
  query: string,
  max: number,
): readonly M[] {
  const wanted = query.trim().toLocaleLowerCase();
  if (wanted === '') return members.slice(0, max);
  const starts: M[] = [];
  const contains: M[] = [];
  for (const member of members) {
    const name = member.name.toLocaleLowerCase();
    const email = member.email?.toLocaleLowerCase() ?? '';
    if (name.startsWith(wanted) || name.split(/\s+/).some((part) => part.startsWith(wanted))) starts.push(member);
    else if (name.includes(wanted) || email.includes(wanted)) contains.push(member);
  }
  return [...starts, ...contains].slice(0, max);
}
