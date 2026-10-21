// Mentions in a comment's text (spec 0038, decision 1): the text is plain, and
// a mention is a token naming the member by id, `<@member-uuid>`, so a rename
// never rewrites a comment and the text converts into the rich text editor's
// mention nodes later. No Zod here: the data layer (first load) and the server
// both read it through `@crm/contracts/mentions`.

/** The longest comment, in characters, once trimmed at its ends. */
export const COMMENT_MAX = 10_000;

/** The most members one comment may mention. */
export const COMMENT_MENTIONS_MAX = 50;

/** The most comments one thread holds (AC-1153). */
export const THREAD_COMMENTS_MAX = 500;

/** Threads per page of a record's Comments tab (AC-1151). */
export const THREAD_PAGE = 20;

/** The most threads `comments.get` reads at once. */
export const THREAD_GET_MAX = 50;

/** The reactions a comment may carry (decision 6), in the menu's order. */
export const COMMENT_EMOJI = ['👍', '❤️', '🎉', '😄', '👀', '✅'] as const;

/** One of the six reactions. */
export type CommentEmoji = (typeof COMMENT_EMOJI)[number];

/** True when `value` is one of the six reactions. */
export const isCommentEmoji = (value: string): value is CommentEmoji =>
  (COMMENT_EMOJI as readonly string[]).includes(value);

/** A mention token: `<@` then a uuid, then `>`. Lower case hex, as the server writes it. */
const TOKEN = /<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

/** The token for a member. */
export const mentionToken = (memberId: string): string => `<@${memberId.toLowerCase()}>`;

/** One piece of a comment's text: plain text, or a mention of a member by id. */
export type BodySegment =
  { readonly kind: 'text'; readonly text: string } | { readonly kind: 'mention'; readonly memberId: string };

/** A comment's text as pieces, in order: what a screen draws, with each mention named from the members list. */
export function bodySegments(body: string): readonly BodySegment[] {
  const segments: BodySegment[] = [];
  let at = 0;
  for (const match of body.matchAll(TOKEN)) {
    const index = match.index;
    if (index > at) segments.push({ kind: 'text', text: body.slice(at, index) });
    segments.push({ kind: 'mention', memberId: (match[1] ?? '').toLowerCase() });
    at = index + match[0].length;
  }
  if (at < body.length) segments.push({ kind: 'text', text: body.slice(at) });
  return segments;
}

/** The pieces back as stored text. */
export function joinSegments(segments: readonly BodySegment[]): string {
  return segments.map((segment) => (segment.kind === 'text' ? segment.text : mentionToken(segment.memberId))).join('');
}

/** The members a text mentions, each once, in the order first mentioned. */
export function mentionedIds(body: string): readonly string[] {
  return [...new Set([...body.matchAll(TOKEN)].map((match) => (match[1] ?? '').toLowerCase()))];
}

/**
 * The start of a text, at most `max` characters of what shows (a mention
 * counts as one), never cutting a token in two; "…" when anything was left
 * out. A notification's excerpt (AC-1169).
 */
export function excerptOf(body: string, max: number): string {
  let shown = 0;
  let out = '';
  for (const segment of bodySegments(body)) {
    if (segment.kind === 'mention') {
      if (shown + 1 > max) return `${out.trimEnd()}…`;
      out += mentionToken(segment.memberId);
      shown += 1;
      continue;
    }
    const room = max - shown;
    if (segment.text.length > room) return `${(out + segment.text.slice(0, room)).trimEnd()}…`;
    out += segment.text;
    shown += segment.text.length;
  }
  return out;
}
