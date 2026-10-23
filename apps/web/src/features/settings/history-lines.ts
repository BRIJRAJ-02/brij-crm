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
    case 'unknown':
      return { name: people.unknown };
  }
}

/** A person inside a sentence: as the Who column names them, but an unknown one is "a former member". */
function personName(person: AuditPerson): string {
  return person.kind === 'unknown' ? people.unknownTarget : whoOf(person).name;
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
    thing: (target) => (target.isGone || target.name === undefined ? strings.gone[target.type] : target.name),
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
  const template = strings.sentences[entry.action] as (entry: AuditEntryView, w: SentenceWords) => Sentence;
  const sentence = template(entry, wordsFor(format));
  if (sentence.subject === 'none') return { full: sentence.text, change: sentence.text };
  return { full: `${whoOf(entry.actor).name} ${sentence.text}`, change: capitalised(sentence.text) };
}

/** Every action with a sentence: what `history-lines.test.ts` walks against the catalog. */
export const SENTENCE_ACTIONS = Object.keys(strings.sentences) as readonly ListedAuditAction[];

/** The templates, typed per action, for the tests. */
export const templates: SentenceTemplates = strings.sentences;
