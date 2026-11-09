import { Button as AriaButton } from 'react-aria-components';
import type { JSONContent } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, StickyNote, Check } from 'lucide-react';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { NoteEditor, type MentionPerson } from '../RichTextEditor/RichTextEditor.tsx';
import { TextSwap, DropIn, ShimmerText } from '../Motion/Motion.tsx';
import './NoteList.css';

/** A note on a record. `updated` is already a relative label ("2h ago"). */
export interface Note { readonly id: string; readonly title: string; readonly body: string; readonly author: string; readonly updated: string }

/** Where an autosave stands. */
export type SaveState = 'idle' | 'saving' | 'saved';

/** "Saving…" shimmering while a save is in flight, then "Saved" with a tick; the swap crossfades so nothing jumps. */
export function SaveIndicator({ state }: { readonly state: SaveState }) {
  return (
    <span className="tf-note-save" role="status" aria-live="polite">
      <TextSwap swapKey={state}>{state === 'saving' ? <ShimmerText>Saving…</ShimmerText> : state === 'saved' ? <><Check size={14} strokeWidth={2} />Saved</> : <span className="tf-sr-only">No changes</span>}</TextSwap>
    </span>
  );
}

/** A note as a card: title, two lines of preview, author and time. Pressing it opens the note. */
export function NoteCard({ note, onOpen }: { readonly note: Note; readonly onOpen?: (id: string) => void }) {
  const preview = note.body.replace(/[*_#>-]/g, '').replace(/\s+/g, ' ').trim();
  return (
    <AriaButton className="tf-note-card" onPress={() => onOpen?.(note.id)}>
      <span className="tf-note-card__title">{note.title || 'Untitled'}</span>
      <span className="tf-note-card__preview">{preview || 'No text yet'}</span>
      <span className="tf-note-card__meta"><Avatar name={note.author} size={20} /><span>{note.author}</span><span aria-hidden="true">·</span><span>{note.updated}</span></span>
    </AriaButton>
  );
}

/** Props for NoteList. */
export interface NoteListProps {
  readonly notes: ReadonlyArray<Note>;
  readonly onOpen: (id: string) => void;
  readonly onNew?: () => void;
  /** Ids added since the list first drew; they drop in. */
  readonly freshIds?: ReadonlySet<string>;
}

/** A record's notes as a grid of cards, newest first, with New note; an empty list says what notes are for. */
export function NoteList({ notes, onOpen, onNew, freshIds }: NoteListProps) {
  return (
    <section className="tf-notes" aria-label="Notes">
      <div className="tf-notes__head">
        <h3 className="tf-notes__title">Notes <span className="tf-notes__count">{notes.length}</span></h3>
        {onNew && <Button size="sm" variant="secondary" icon={<Plus size={14} strokeWidth={1.75} />} onPress={onNew}>New note</Button>}
      </div>
      {notes.length === 0 ? (
        <div className="tf-notes__empty"><StickyNote size={20} strokeWidth={1.75} aria-hidden="true" /><strong>No notes yet</strong><span>Write down what you learned on a call, so the team sees it too.</span></div>
      ) : (
        <ul className="tf-notes__grid">
          {notes.map((n) => <li key={n.id}><DropIn animate={freshIds?.has(n.id) ?? false}><NoteCard note={n} onOpen={onOpen} /></DropIn></li>)}
        </ul>
      )}
    </section>
  );
}

/** Plain text of a Tiptap document, one line per block; what a note card previews. */
function textOf(node: JSONContent): string {
  if (node.text) return node.text;
  const parts = (node.content ?? []).map(textOf);
  return node.type === 'paragraph' || node.type === 'heading' ? parts.join('') : parts.join('\n');
}

/** A stored note body ("- " lines become a list, blank lines split paragraphs) as HTML the editor starts from. */
function toHtml(body: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return body.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    return lines.every((l) => l.startsWith('- '))
      ? `<ul>${lines.map((l) => `<li><p>${esc(l.slice(2))}</p></li>`).join('')}</ul>`
      : `<p>${esc(block)}</p>`;
  }).join('');
}

/** Props for NotePage. */
export interface NotePageProps {
  readonly note: Note;
  /** Saves the note; called 600ms after typing stops. `body` is the plain text the card previews. */
  readonly onSave: (note: Note) => Promise<void> | void;
  readonly onBack?: () => void;
  /** Members for `@` in the text. */
  readonly people?: ReadonlyArray<MentionPerson>;
}

/** One note open on a record: back to the list, the shared NoteEditor (Tiptap), and a save line that says when it saved. */
export function NotePage({ note, onSave, onBack, people }: NotePageProps) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [state, setState] = useState<SaveState>('idle');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setState('saving');
    const t = window.setTimeout(() => {
      void Promise.resolve(onSave({ ...note, title, body })).then(() => setState('saved'));
    }, 600);
    return () => window.clearTimeout(t);
  }, [title, body]);
  return (
    <article className="tf-notes__page" aria-label="Note">
      <div className="tf-notes__bar">
        {onBack && <IconButton size="sm" label="Back to notes" onPress={onBack}><ArrowLeft size={14} strokeWidth={1.75} /></IconButton>}
        <SaveIndicator state={state} />
      </div>
      <NoteEditor label="Note" title={title} onTitleChange={setTitle} people={people} defaultContent={toHtml(note.body)}
        autoFocusOn={note.title ? 'text' : 'title'} onChange={(doc) => setBody(textOf(doc))} />
      <p className="tf-notes__meta"><Avatar name={note.author} size={20} />{note.author} · edited {state === 'idle' ? note.updated : 'just now'}</p>
    </article>
  );
}
