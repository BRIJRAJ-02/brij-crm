// Spec 0068's bento cards (AC-6808) as the editor's Modals have them, checked as the server will before anything is
// sent: a profile card, a status, an audio intro, a timeline, logos, work cards, how I work, a location and events.
// No Zod (the store loads with the editor, in its own chunk); the server checks every one again with the contract.
import type { ProfileBlock } from '@crm/contracts';
import {
  checkProfileLink,
  PROFILE_ADDRESS_MAX,
  PROFILE_AUDIO_TITLE_MAX,
  PROFILE_CARD_LINE_MAX,
  PROFILE_CARD_TITLE_MAX,
  PROFILE_CONTROL,
  PROFILE_EVENTS_ITEMS,
  PROFILE_ITEM_TITLE_MAX,
  PROFILE_LOCATION_TITLE_MAX,
  PROFILE_LOGO_ALT_MAX,
  PROFILE_LOGOS_MAX,
  PROFILE_LOGOS_MIN,
  PROFILE_PLACE_MAX,
  PROFILE_STATUS_MAX,
  PROFILE_STEP_BODY_MAX,
  PROFILE_STEPS_MAX,
  PROFILE_STEPS_MIN,
  PROFILE_TIMELINE_ITEMS,
  PROFILE_WAVE,
  PROFILE_WHEN_MAX,
  PROFILE_WORK_BODY_MAX,
  PROFILE_WORK_ITEMS,
  profileLinkProblem,
} from '@crm/contracts/link-page';
import type { DraftExtras } from './reach.ts';

/** Spec 0068's cards as the editor's Modals have them, before they are checked. */
export type BentoDraft =
  | ({ readonly kind: 'profile'; readonly line: string } & DraftExtras)
  | ({ readonly kind: 'status'; readonly text: string; readonly state: 'open' | 'away' } & DraftExtras)
  | ({
      readonly kind: 'audio';
      readonly audio?: string;
      readonly title: string;
      readonly wave?: string;
    } & DraftExtras)
  | ({
      readonly kind: 'timeline';
      readonly title: string;
      readonly items: readonly { readonly when: string; readonly title: string; readonly place: string }[];
    } & DraftExtras)
  | ({
      readonly kind: 'logos';
      readonly title: string;
      readonly images: readonly { readonly image: string; readonly alt: string }[];
    } & DraftExtras)
  | ({
      readonly kind: 'work';
      readonly title: string;
      readonly items: readonly {
        readonly image?: string;
        readonly title: string;
        readonly body: string;
        readonly url: string;
      }[];
    } & DraftExtras)
  | ({
      readonly kind: 'steps';
      readonly title: string;
      readonly items: readonly { readonly title: string; readonly body: string }[];
    } & DraftExtras)
  | ({ readonly kind: 'location'; readonly title: string; readonly address: string } & DraftExtras)
  | ({
      readonly kind: 'events';
      readonly title: string;
      /** `at` as the editor's date and time picker answers it, an ISO instant, or empty while unset. */
      readonly items: readonly {
        readonly title: string;
        readonly at: string;
        readonly place: string;
        readonly url: string;
      }[];
    } & DraftExtras);

/** The kinds a `BentoDraft` is. */
export const BENTO_KINDS = [
  'profile',
  'status',
  'audio',
  'timeline',
  'logos',
  'work',
  'steps',
  'location',
  'events',
] as const satisfies readonly BentoDraft['kind'][];

/** Whether a draft is one of spec 0068's cards. */
export function isBentoDraft(draft: { readonly kind: string }): draft is BentoDraft {
  return BENTO_KINDS.some((kind) => kind === draft.kind);
}

/** Why a card's field can't be kept, by field: `items.1.title` is the second row's title. */
export type BentoProblems = Readonly<Partial<Record<string, string>>>;

/**
 * One line, required or not: the trimmed words, or their problem. `empty` is the sentence for a required one left
 * blank; without it an empty line is simply left out.
 */
function line(
  typed: string,
  max: number,
  long: string,
  empty?: string,
): { readonly text: string; readonly problem?: string } {
  const text = typed.trim();
  if (text === '') return empty === undefined ? { text } : { text, problem: empty };
  if (PROFILE_CONTROL.test(text)) return { text, problem: 'Keep it to one line, with no special characters.' };
  return text.length > max ? { text, problem: long } : { text };
}

/** A web address that may be left out: the canonical address, or its problem. */
function optionalUrl(typed: string): { readonly url?: string; readonly problem?: string } {
  const value = typed.trim();
  if (value === '') return {};
  const checked = checkProfileLink(value);
  return checked.ok ? { url: checked.url } : { problem: profileLinkProblem(checked.reason) };
}

/** A field kept only when it says something. */
const kept = <Key extends string>(key: Key, text: string | undefined) =>
  (text === undefined || text === '' ? {} : { [key]: text }) as Partial<Record<Key, string>>;

/** A card's own small title, checked: at most 40, or left out. */
function cardTitle(typed: string, problems: Record<string, string>): Partial<Record<'title', string>> {
  const title = line(typed, PROFILE_CARD_TITLE_MAX, 'Keep the title to 40 characters.');
  if (title.problem !== undefined) problems.title = title.problem;
  return kept('title', title.text);
}

/** How many rows a card holds, against its least and most: the problem, or undefined. */
function countProblem(count: number, least: number, most: number, few: string, many: string): string | undefined {
  if (count < least) return few;
  return count > most ? many : undefined;
}

/** One of spec 0068's cards as typed, checked as the server will: each field's problem, or the block to send. */
export function checkBentoBlock(
  draft: BentoDraft,
): { readonly ok: true; readonly block: ProfileBlock } | { readonly ok: false; readonly problems: BentoProblems } {
  const problems: Record<string, string> = {};
  const done = (block: ProfileBlock) =>
    Object.keys(problems).length > 0 ? { ok: false as const, problems } : { ok: true as const, block };
  switch (draft.kind) {
    case 'profile': {
      const said = line(draft.line, PROFILE_CARD_LINE_MAX, 'Keep the line to 80 characters.');
      if (said.problem !== undefined) problems.line = said.problem;
      return done({ kind: 'profile', ...kept('line', said.text) });
    }
    case 'status': {
      const said = line(
        draft.text,
        PROFILE_STATUS_MAX,
        'Keep the status to 40 characters.',
        'Say what you’re open to.',
      );
      if (said.problem !== undefined) problems.text = said.problem;
      return done({ kind: 'status', text: said.text, ...(draft.state === 'away' ? { state: 'away' as const } : {}) });
    }
    case 'audio': {
      if (draft.audio === undefined) problems.audio = 'Add a recording.';
      const title = line(draft.title, PROFILE_AUDIO_TITLE_MAX, 'Keep the title to 60 characters.');
      if (title.problem !== undefined) problems.title = title.problem;
      const wave = draft.wave !== undefined && PROFILE_WAVE.test(draft.wave) ? { wave: draft.wave } : {};
      return done({ kind: 'audio', audio: draft.audio ?? '', ...kept('title', title.text), ...wave });
    }
    case 'location': {
      const title = line(draft.title, PROFILE_LOCATION_TITLE_MAX, 'Keep the name to 60 characters.');
      if (title.problem !== undefined) problems.title = title.problem;
      const address = line(
        draft.address,
        PROFILE_ADDRESS_MAX,
        'Keep the address to 200 characters.',
        'Write the address.',
      );
      if (address.problem !== undefined) problems.address = address.problem;
      return done({ kind: 'location', address: address.text, ...kept('title', title.text) });
    }
    case 'timeline': {
      const title = cardTitle(draft.title, problems);
      const many = countProblem(
        draft.items.length,
        1,
        PROFILE_TIMELINE_ITEMS,
        'Add at least one row.',
        'Keep it to 12 rows.',
      );
      if (many !== undefined) problems.items = many;
      const items = draft.items.map((row, at) => {
        const when = line(row.when, PROFILE_WHEN_MAX, 'Keep it to 20 characters.', 'Say when, like 2021.');
        const what = line(row.title, PROFILE_ITEM_TITLE_MAX, 'Keep it to 60 characters.', 'Say what you did.');
        const place = line(row.place, PROFILE_PLACE_MAX, 'Keep it to 60 characters.');
        if (when.problem !== undefined) problems[`items.${String(at)}.when`] = when.problem;
        if (what.problem !== undefined) problems[`items.${String(at)}.title`] = what.problem;
        if (place.problem !== undefined) problems[`items.${String(at)}.place`] = place.problem;
        return { when: when.text, title: what.text, ...kept('place', place.text) };
      });
      return done({ kind: 'timeline', items, ...title });
    }
    case 'logos': {
      const title = cardTitle(draft.title, problems);
      const many = countProblem(
        draft.images.length,
        PROFILE_LOGOS_MIN,
        PROFILE_LOGOS_MAX,
        'Add at least two logos.',
        'Keep it to 12 logos.',
      );
      if (many !== undefined) problems.images = many;
      const images = draft.images.map((logo, at) => {
        const alt = line(logo.alt, PROFILE_LOGO_ALT_MAX, 'Keep the name to 80 characters.', 'Name the client.');
        if (alt.problem !== undefined) problems[`images.${String(at)}.alt`] = alt.problem;
        return { image: logo.image, alt: alt.text };
      });
      return done({ kind: 'logos', images, ...title });
    }
    case 'work': {
      const title = cardTitle(draft.title, problems);
      const many = countProblem(
        draft.items.length,
        1,
        PROFILE_WORK_ITEMS,
        'Add a piece of work.',
        'Keep it to 6 pieces.',
      );
      if (many !== undefined) problems.items = many;
      const items = draft.items.map((piece, at) => {
        const what = line(piece.title, PROFILE_ITEM_TITLE_MAX, 'Keep the title to 60 characters.', 'Give it a title.');
        const body = line(piece.body, PROFILE_WORK_BODY_MAX, 'Keep it to 160 characters.');
        const link = optionalUrl(piece.url);
        if (what.problem !== undefined) problems[`items.${String(at)}.title`] = what.problem;
        if (body.problem !== undefined) problems[`items.${String(at)}.body`] = body.problem;
        if (link.problem !== undefined) problems[`items.${String(at)}.url`] = link.problem;
        return {
          title: what.text,
          ...(piece.image === undefined ? {} : { image: piece.image }),
          ...kept('body', body.text),
          ...kept('url', link.url),
        };
      });
      return done({ kind: 'work', items, ...title });
    }
    case 'steps': {
      const title = cardTitle(draft.title, problems);
      const many = countProblem(
        draft.items.length,
        PROFILE_STEPS_MIN,
        PROFILE_STEPS_MAX,
        'Add at least two steps.',
        'Keep it to 6 steps.',
      );
      if (many !== undefined) problems.items = many;
      const items = draft.items.map((step, at) => {
        const name = line(
          step.title,
          PROFILE_ITEM_TITLE_MAX,
          'Keep the step’s name to 60 characters.',
          'Name the step.',
        );
        const body = line(step.body, PROFILE_STEP_BODY_MAX, 'Keep it to 240 characters.', 'Say what happens.');
        if (name.problem !== undefined) problems[`items.${String(at)}.title`] = name.problem;
        if (body.problem !== undefined) problems[`items.${String(at)}.body`] = body.problem;
        return { title: name.text, body: body.text };
      });
      return done({ kind: 'steps', items, ...title });
    }
    case 'events': {
      const title = cardTitle(draft.title, problems);
      const many = countProblem(draft.items.length, 1, PROFILE_EVENTS_ITEMS, 'Add an event.', 'Keep it to 8 events.');
      if (many !== undefined) problems.items = many;
      const items = draft.items.map((event, at) => {
        const name = line(event.title, PROFILE_ITEM_TITLE_MAX, 'Keep the name to 60 characters.', 'Name the event.');
        const place = line(event.place, PROFILE_PLACE_MAX, 'Keep it to 60 characters.');
        const link = optionalUrl(event.url);
        const when = Date.parse(event.at);
        if (name.problem !== undefined) problems[`items.${String(at)}.title`] = name.problem;
        if (place.problem !== undefined) problems[`items.${String(at)}.place`] = place.problem;
        if (link.problem !== undefined) problems[`items.${String(at)}.url`] = link.problem;
        if (Number.isNaN(when)) problems[`items.${String(at)}.at`] = 'Pick a date and time.';
        return {
          title: name.text,
          at: Number.isNaN(when) ? event.at : new Date(when).toISOString(),
          ...kept('place', place.text),
          ...kept('url', link.url),
        };
      });
      return done({ kind: 'events', items, ...title });
    }
  }
}
