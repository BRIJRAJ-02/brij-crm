// The timeline's records as links to their own pages (spec 0017, AC-379):
// the data layer names the records a link entry added or removed; the page
// knows each object's address, so it adds the href here. Plain functions with
// no React, so they test in Node.
import { durationWords, outcomeTag } from '../notes/activity.ts';
import { strings as noteStrings } from '../notes/strings.ts';
import type { ActivityEntryShape, EntrySource, ObjectSummary } from '@crm/data';
import { recordHref } from './details.ts';

/** A task's dialog over the page (spec 0019): the page's address with `?task=<id>`; a note's `?note=`, a thread's `?thread=`. */
export type TaskLink = (itemId: string, kind?: 'task' | 'note' | 'thread' | 'log') => string;

/** A record's page from its object's id, or undefined when the object isn't one the person can open. */
export type RecordLink = (objectId: string, recordId: string) => string | undefined;

/** Links to records of the workspace's objects, by their address, on their Overview. */
export function recordLinks(slug: string, objects: readonly ObjectSummary[]): RecordLink {
  const slugs = new Map(objects.map((object) => [object.id, object.apiSlug]));
  return (objectId, recordId) => {
    const objectSlug = slugs.get(objectId);
    return objectSlug === undefined ? undefined : recordHref(slug, objectSlug, recordId);
  };
}

/** A link entry with each named record's page, a task entry with its dialog's, a meeting's people with theirs. */
export function withLinks(entry: ActivityEntryShape, link: RecordLink, taskLink?: TaskLink): ActivityEntryShape {
  if (entry.kind === 'task') return taskLink === undefined ? entry : { ...entry, href: taskLink(entry.itemId) };
  // A thread (spec 0038): its place on the Comments tab.
  if (entry.kind === 'comment') {
    return taskLink === undefined ? entry : { ...entry, href: taskLink(entry.itemId, 'thread') };
  }
  // A note (spec 0019, AC-444): its window's address, and "Untitled note" for one with no title.
  if (entry.kind === 'note') {
    const titled = entry.title === '' ? { ...entry, title: noteStrings.untitled } : entry;
    return taskLink === undefined ? titled : { ...titled, href: taskLink(entry.itemId, 'note') };
  }
  // A call or meeting a person logged (migration 0137): its length and outcome worded, its dialog's address.
  if (entry.kind === 'call' || entry.kind === 'logged_meeting') {
    const tag = outcomeTag(entry.outcomeId);
    const worded = {
      ...entry,
      ...(entry.durationMinutes === undefined ? {} : { duration: durationWords(entry.durationMinutes) }),
      ...(tag === undefined ? {} : { outcome: tag }),
    };
    return taskLink === undefined ? worded : { ...worded, href: taskLink(entry.itemId, 'log') };
  }
  // A meeting's people (spec 0024): each person's chip links to their page; members and addresses stay as they are.
  if (entry.kind === 'meeting') {
    return {
      ...entry,
      attendees: entry.attendees.map((attendee) => {
        const display = attendee.display;
        if (display === undefined || !('recordId' in display)) return attendee;
        const href = link(display.objectId, display.recordId);
        return href === undefined ? attendee : { ...attendee, href };
      }),
    };
  }
  if (entry.kind !== 'links') return entry;
  const linked = (records: typeof entry.added) =>
    records.map((record) => {
      const href = link(record.display.objectId, record.display.recordId);
      return href === undefined ? record : { ...record, href };
    });
  return { ...entry, added: linked(entry.added), removed: linked(entry.removed) };
}

/**
 * The feed's source with link entries' records linked to their pages. Each
 * entry is linked once and kept, so the feed sees the same object for the
 * same entry and draws it again only when the entry itself changes.
 */
export function linkedSource(
  source: EntrySource,
  link: RecordLink,
  cache: WeakMap<object, ActivityEntryShape>,
  taskLink?: TaskLink,
): EntrySource {
  return {
    ...source,
    getItem: (index) => {
      const entry = source.getItem(index);
      if (
        entry === undefined ||
        (entry.kind !== 'links' &&
          entry.kind !== 'task' &&
          entry.kind !== 'note' &&
          entry.kind !== 'call' &&
          entry.kind !== 'logged_meeting' &&
          entry.kind !== 'comment' &&
          entry.kind !== 'meeting')
      ) {
        return entry;
      }
      const held = cache.get(entry);
      if (held !== undefined) return held;
      const made = withLinks(entry, link, taskLink);
      cache.set(entry, made);
      return made;
    },
  };
}
