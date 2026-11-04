// Workspace changes' rows in words (spec 0046, AC-4604 to AC-4607): pure
// functions from one audit entry to its Who cell and its sentence, and the kind
// an action is listed under. Dates come in through `format`, so the screen
// hands over the reader's language, zone and date format and the tests a fixed
// one. Imported only by History's screen modules and their tests.
import {
  auditKindOf,
  ROLE_LABELS,
  type AuditEntryView,
  type AuditKindName,
  type AuditPerson,
  type ListedAuditAction,
} from '@crm/data';
import { strings, type Sentence, type SentenceTemplates, type SentenceWords } from './history-strings.ts';

const people = strings.people;

/** How dates read in a sentence: the reader's own format and zone. */
export interface HistoryFormat {
  /** A day: "24 Oct 2026". */
  readonly day: (at: string) => string;
  /** A day and a time: "24 Oct, 3:30 pm". */
  readonly dayTime: (at: string) => string;
  /** The calendar day an instant falls on in the reader's zone, as `YYYY-MM-DD`: what groups rows by day. */
  readonly dayKey: (at: string) => string;
}

/** The kind an action is listed under (People and roles, Invitations and joining, …); undefined when not listed. */
export function kindOf(action: string): AuditKindName | undefined {
  return auditKindOf(action);
}

/** Who did it, as the Who column shows it: a name, with a quiet badge for a former member or someone asking to join. */
export interface Who {
  readonly name: string;
  readonly badge?: string;
}

/** The Who column for a person (AC-4606). */
export function whoOf(person: AuditPerson): Who {
  switch (person.kind) {
    case 'member':
      if (person.state === 'deleted') return { name: people.deleted };
      return person.state === 'former' ? { name: person.name, badge: people.former } : { name: person.name };
    case 'asker':
      return { name: person.name, badge: people.asker };
    case 'system':
      return { name: people.system };
    case 'api_key':
      return { name: people.apiKey };
    default:
      // An unknown row, or a kind of actor this page doesn't know yet.
      return { name: people.unknown };
  }
}

/** A person inside a sentence: as the Who column names them, but in lower case for a deleted or unknown one. */
function personName(person: AuditPerson): string {
  if (person.kind === 'unknown') return people.unknownTarget;
  if (person.kind === 'member' && person.state === 'deleted') return people.deletedTarget;
  return whoOf(person).name;
}

/** "name", "name and time zone", "name, time zone and bio". */
function listOf(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}

function wordsFor(format: HistoryFormat): SentenceWords {
  return {
    person: personName,
    persons: (person) => `${personName(person)}’s`,
    role: (role) => ROLE_LABELS[role],
    invitation: (target) => target.email ?? (target.isLink ? strings.gone.inviteLink : strings.gone.invitation),
    booking: (target) =>
      target.isGone || target.pageTitle === undefined || target.startsAt === undefined
        ? strings.gone.booking
        : strings.bookingOn(target.pageTitle, format.dayTime(target.startsAt)),
    thing: (target) =>
      target.isGone || target.name === undefined
        ? // A list the reader can't read is named by no name, and isn't gone (spec 0048).
          target.type === 'list' && !target.isGone
          ? strings.someList
          : strings.gone[target.type]
        : target.name,
    the: (target, noun, place = 'before') => {
      if (target.isGone || target.name === undefined) {
        // A list the reader can't read is there, unnamed (spec 0048); one that is gone says so once.
        return target.type === 'list' && !target.isGone ? strings.someList : strings.goneThing(noun);
      }
      return place === 'after' ? `the ${target.name} ${noun}` : `the ${noun} ${target.name}`;
    },
    day: format.day,
    list: listOf,
  };
}

/** One row's sentence: `full` as a screen reader hears the row, `change` as the Change column shows it. */
export interface RowSentence {
  readonly full: string;
  readonly change: string;
}

const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The sentence for one entry (AC-4605): its action's template, starting with the actor's name ("Ada Lovelace
 * changed Bea Rao’s role from Member to Admin"). The Change column leaves the actor out and starts with a capital.
 */
export function entrySentence(entry: AuditEntryView, format: HistoryFormat): RowSentence {
  // A newer server may list an action this page doesn't know yet (a deploy in between): a plain line, not a crash.
  const template = (
    strings.sentences as Partial<Record<string, (entry: AuditEntryView, w: SentenceWords) => Sentence>>
  )[entry.action];
  const sentence =
    template === undefined
      ? { subject: 'actor' as const, text: strings.someChange }
      : template(entry, wordsFor(format));
  if (sentence.subject === 'none') return { full: sentence.text, change: sentence.text };
  return { full: `${whoOf(entry.actor).name} ${sentence.text}`, change: capitalised(sentence.text) };
}

/** Every action with a sentence: what `history-lines.test.ts` walks against the catalog. */
export const SENTENCE_ACTIONS = Object.keys(strings.sentences) as readonly ListedAuditAction[];

/** The templates, typed per action, for the tests. */
export const templates: SentenceTemplates = strings.sentences;

/** One row of Workspace changes: an entry, or a run of the same change by the same person collapsed into it. */
export interface HistoryRow {
  /** The newest entry's id: the row's key. */
  readonly id: string;
  /** The newest entry of the run, which the row shows. */
  readonly entry: AuditEntryView;
  /** How many entries the row stands for: 1, or the run's length. */
  readonly count: number;
  /** The row's sentence, with "3 times" after it for a run. */
  readonly sentence: RowSentence;
}

/** How far apart two entries of a run may be (an hour): repeats further apart stay their own rows. */
export const RUN_GAP_MS = 60 * 60 * 1000;

/** Whose an entry is, so a run is one person's: a member by id, anyone else by their kind and name. */
const actorKey = (person: AuditPerson): string =>
  person.kind === 'member' ? `member:${person.memberId}` : `${person.kind}:${'name' in person ? person.name : ''}`;

/**
 * The entries (newest first) as rows (critic A, 5 November 2026: 50 rows of one person saving the same list): a
 * run of entries by the same person whose sentences read the same, each within `gap` of the next, is one row
 * saying how many times ("Changed the list Sales 5 times"). Only identical sentences collapse, so a count never
 * hides a difference (two role changes with different roles stay two rows).
 */
export function collapseRuns(
  entries: readonly AuditEntryView[],
  format: HistoryFormat,
  gap: number = RUN_GAP_MS,
): readonly HistoryRow[] {
  const runs: {
    readonly first: AuditEntryView;
    readonly sentence: RowSentence;
    last: AuditEntryView;
    count: number;
  }[] = [];
  for (const entry of entries) {
    const sentence = entrySentence(entry, format);
    const run = runs.at(-1);
    if (
      run !== undefined &&
      actorKey(run.last.actor) === actorKey(entry.actor) &&
      run.sentence.full === sentence.full &&
      Math.abs(Date.parse(run.last.at) - Date.parse(entry.at)) <= gap
    ) {
      run.last = entry;
      run.count += 1;
    } else {
      runs.push({ first: entry, last: entry, count: 1, sentence });
    }
  }
  return runs.map(({ first, count, sentence }) => ({
    id: first.id,
    entry: first,
    count,
    sentence:
      count === 1
        ? sentence
        : { full: strings.times(sentence.full, count), change: strings.times(sentence.change, count) },
  }));
}

/** One day of rows, under its heading. */
export interface HistoryDay {
  /** `YYYY-MM-DD` in the reader's zone. */
  readonly key: string;
  /** "Today", "Yesterday", else the day in the reader's format. */
  readonly label: string;
  readonly rows: readonly HistoryRow[];
}

/** The day before a `YYYY-MM-DD` key. */
const dayBefore = (key: string): string => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

/**
 * The rows (newest first) by the day they happened in the reader's zone (critic A, 5 November 2026), each day under
 * "Today", "Yesterday" or its date, as Linear's and Vercel's activity read. `now` is the reader's clock.
 */
export function byDay(rows: readonly HistoryRow[], format: HistoryFormat, now: string): readonly HistoryDay[] {
  const today = format.dayKey(now);
  const yesterday = dayBefore(today);
  const days: { readonly key: string; readonly label: string; readonly rows: HistoryRow[] }[] = [];
  for (const row of rows) {
    const key = format.dayKey(row.entry.at);
    const day = days.at(-1);
    if (day?.key === key) {
      day.rows.push(row);
      continue;
    }
    const label = key === today ? strings.today : key === yesterday ? strings.yesterday : format.day(row.entry.at);
    days.push({ key, label, rows: [row] });
  }
  return days;
}
