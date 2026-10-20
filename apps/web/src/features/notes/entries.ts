// Notes as the library draws them (spec 0019, value sourcing): plain
// functions with no React, so they test in Node. A note's author is named
// from the members ("Former member" for one no longer active), and a `note`
// search param names a note or a new one.
import type { ActorDisplay, MemberSummary, NoteSummary } from '@crm/data';
import type { NoteListItem } from '@crm/ui';
import { strings as taskStrings } from '../tasks/strings.ts';
import { strings } from './strings.ts';

/** Who an actor is, as a display: a member by name ("Former member" when no longer here), else what acted. */
export function actorDisplay(
  members: readonly MemberSummary[],
  actor: { readonly type: string; readonly id: string | null },
): ActorDisplay {
  if (actor.type === 'member' && actor.id !== null) {
    const member = members.find((each) => each.id === actor.id);
    return member === undefined
      ? { type: 'member', id: actor.id, name: strings.formerMember }
      : { type: 'member', id: member.id, name: member.name, email: member.email };
  }
  const type = actor.type === 'api_key' || actor.type === 'automation' ? actor.type : 'system';
  const name =
    type === 'api_key' ? taskStrings.apiKey : type === 'automation' ? taskStrings.automation : taskStrings.system;
  return { type, id: actor.id, name };
}

/** A note as NoteList's row: its title (empty shows "Untitled note" in the list), excerpt, author and last edit. */
export function toNoteItem(note: NoteSummary, members: readonly MemberSummary[]): NoteListItem {
  return {
    id: note.id,
    title: note.title,
    excerpt: note.excerpt,
    author: actorDisplay(members, note.createdBy),
    updatedAt: note.updatedAt,
  };
}

/** Whether a `note` search param names a note (a uuid) or a new one. */
export function isNoteParam(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === 'new' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
  );
}
