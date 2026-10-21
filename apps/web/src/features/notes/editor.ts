// The note editor's chunk (spec 0019, AC-451): Tiptap loads with the first
// note, never with the app. The Notes tab starts loading it as it shows, so a
// new note's title is there to type into the moment the window opens.
import { lazy } from 'react';

/** The editor, in its own chunk: loaded when a note first opens (or the Notes tab first shows), never with the app. */
export const NoteEditor = lazy(() => import('@crm/ui/editor').then((module) => ({ default: module.NoteEditor })));

/** Starts loading the editor's chunk ahead of the first note; loading it twice costs nothing. */
export function preloadNoteEditor(): void {
  void import('@crm/ui/editor');
}
