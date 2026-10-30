// Notes (spec 0019): what the team learned about a record. A note belongs to
// one record for life, holds the rich text editor's document (Tiptap JSON,
// never HTML) and a title, and saves itself as you type: `notes.save` is an
// upsert by the id the browser minted when the window opened, so nothing is
// stored until there is text, and the first save creates it. Last write wins:
// a save naming an older `baseVersion` is told whose save it replaced.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ActorReferenceValue, Timestamp } from './values/attribute-values.ts';
import { RichTextDoc, RichTextDocBody } from './values/rich-text.ts';
import { NOTE_PAGE_MAX, NOTE_TITLE_MAX } from './note-limits.ts';
import { TaskTotal } from './tasks.ts';
import { RecordRefDisplay } from './values/options.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid, uuidV7 } from './values/ids.ts';

export {
  NOTE_CONTENT_MAX_BYTES,
  NOTE_COUNT_CAP,
  NOTE_EMPTY,
  NOTE_EXCERPT,
  NOTE_PAGE,
  NOTE_PAGE_MAX,
  NOTE_TEXT_MAX,
  NOTE_TITLE_MAX,
  NOTE_TOO_LONG,
  noteBytes,
  noteExcerpt,
  richTextToPlain,
} from './note-limits.ts';

/** The longest cursor `notes.list` takes. */
export const MAX_NOTE_CURSOR = 256;

/**
 * A note as its list shows it: the title ("" shows as "Untitled note"), the
 * first 200 characters of its text, its version, and who made and last
 * edited it, when.
 */
export const NoteSummary = z.object({
  id: Uuid,
  recordId: Uuid,
  title: z.string(),
  excerpt: z.string(),
  version: z.number().int().min(1),
  /** Whether the reader may edit or delete it (`write` on its record's object). */
  canChange: z.boolean(),
  createdAt: Timestamp,
  createdBy: ActorReferenceValue,
  updatedAt: Timestamp,
  updatedBy: ActorReferenceValue,
  /** Its record as a chip shows it: on the workspace's Notes page only, where notes of many records mix. */
  record: RecordRefDisplay.optional(),
});
/** A note as its list shows it. */
export type NoteSummary = z.infer<typeof NoteSummary>;

/** A note with its body, as the note window opens it. */
export const Note = NoteSummary.extend({ content: RichTextDoc });
/** A note with its body. */
export type Note = z.infer<typeof Note>;

/**
 * One save of a note: its first (the id is new: the record, and a title or
 * text) or a later one (only the fields given). `content` is parsed without
 * the 200 KB cap, which the service checks itself, so an oversized note is
 * one answer, 422 `CONFIG_INVALID` on `content`. `baseVersion` is the version
 * this save started from (null for a new note).
 */
export const SaveNoteInput = WorkspaceScoped.extend({
  id: uuidV7('The note id must be a UUID v7.'),
  recordId: Uuid,
  title: z
    .string()
    .max(NOTE_TITLE_MAX, `A note title holds at most ${String(NOTE_TITLE_MAX)} characters.`)
    .refine((title) => !title.includes('\u0000'), { error: 'This text holds a character that can’t be stored.' })
    .optional(),
  content: RichTextDocBody.optional(),
  baseVersion: z.number().int().min(1).nullable().optional(),
  mutationId: Uuid,
});
/** One save of a note. */
export type SaveNoteInput = z.infer<typeof SaveNoteInput>;

/** What a save answers: the note, and whose save it replaced when it started from an older version. */
export const SaveNoteResult = z.object({
  note: NoteSummary,
  overwrote: z.object({ by: ActorReferenceValue, at: Timestamp }).optional(),
});
/** What a save answers. */
export type SaveNoteResult = z.infer<typeof SaveNoteResult>;

/** One note by id. */
export const GetNoteInput = WorkspaceScoped.extend({ noteId: Uuid });
/** One note by id. */
export type GetNoteInput = z.infer<typeof GetNoteInput>;

/**
 * One page of a record's notes, last edited first; with no `recordId`, the
 * workspace's Notes page: every note on a live record the reader may see,
 * each with its record's display, and no total.
 */
export const ListNotesInput = WorkspaceScoped.extend({
  recordId: Uuid.optional(),
  cursor: z.string().min(1).max(MAX_NOTE_CURSOR).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(NOTE_PAGE_MAX, `Ask for at most ${String(NOTE_PAGE_MAX)} notes.`)
    .optional(),
});
/** One page of a record's notes. */
export type ListNotesInput = z.infer<typeof ListNotesInput>;

/** A page of notes, the cursor for the next, and the record's note count on the first page. */
export const NotePage = z.object({
  items: z.array(NoteSummary),
  nextCursor: z.string().optional(),
  total: TaskTotal.optional(),
});
/** A page of notes. */
export type NotePage = z.infer<typeof NotePage>;

/** Where a page of notes ends, inside the opaque cursor: the last note's edit moment and id. Strict. */
export const NoteCursor = z.strictObject({ updatedAt: z.string().max(40), id: Uuid });
/** Where a page of notes ends. */
export type NoteCursor = z.infer<typeof NoteCursor>;

/** Deleting or restoring one note. */
export const NoteLifecycleInput = WorkspaceScoped.extend({ noteId: Uuid, mutationId: Uuid });
/** Deleting or restoring one note. */
export type NoteLifecycleInput = z.infer<typeof NoteLifecycleInput>;

/** The notes procedures (spec 0019). Every one takes `WorkspaceScoped` input and is served behind the member door. */
export const notesContract = {
  save: oc.input(SaveNoteInput).output(SaveNoteResult),
  get: oc.input(GetNoteInput).output(Note),
  list: oc.input(ListNotesInput).output(NotePage),
  delete: oc.input(NoteLifecycleInput).output(z.object({ ok: z.literal(true) })),
  restore: oc.input(NoteLifecycleInput).output(NoteSummary),
};
