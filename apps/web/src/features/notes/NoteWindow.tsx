// Brief
// Purpose: one note, on `?note=<id>` (or `?note=new`) over the record page, written as a page (Notion's centre peek).
// Main task: write what was learned (a title and the body), and trust that it's saved.
// Leaves out: writing together in real time and versions (#27), comments on a passage (#29), moving a note, templates.
import {
  NOTE_TITLE_MAX,
  type ActorDisplay,
  type MemberSummary,
  type NoteSession,
  type NoteSessionState,
  type RecordRefDisplay,
  type RichTextDoc,
} from '@crm/data';
import { useNoteSession } from '@crm/data/react';
import {
  Button,
  Callout,
  EmptyState,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  RecordChip,
  RelativeTime,
  Skeleton,
  Tooltip,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { deleteWithUndo } from '../tasks/undo-delete.ts';
import { NoteEditor } from './editor.ts';
import { actorDisplay } from './entries.ts';
import { strings } from './strings.ts';

/** Props for the note window. */
export interface NoteWindowProps {
  readonly slug: string;
  /** The note's id, or `new`. */
  readonly note: string;
  /** The page's record: every note here is on it. */
  readonly record: RecordRefDisplay;
  readonly recordHref?: string;
  readonly members: readonly MemberSummary[];
  /** The person may change the record's object. */
  readonly canChange: boolean;
  /** A new note's first save stored it: the address names it from now on (replacing `new`). */
  readonly onStored: (noteId: string) => void;
  /** Closes it (the address loses `?note`). */
  readonly onClose: () => void;
}

/** A session that only says it is loading, until the store's arrives (so the window is one dialog throughout). */
const LOADING_STATE: NoteSessionState = {
  status: 'loading',
  noteId: '',
  recordId: '',
  isNew: false,
  title: '',
  docKey: 0,
  canChange: false,
  saveState: 'idle',
  isTooLong: false,
  isUnavailable: false,
};
const LOADING_SESSION: NoteSession = {
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING_STATE,
  retain: () => () => undefined,
  setTitle: () => undefined,
  setDoc: () => undefined,
  flush: () => undefined,
  retry: () => undefined,
  dismissNotice: () => undefined,
};

/**
 * The bar's word on the note: its save state while it saves ("Saving…",
 * "Saved", "Not saved. Retrying…", "Not saved."), else when it was last edited.
 * The edit time ticks on quietly (aria-live off), so the bar's status announces
 * only the save state's changes.
 */
function statusOf(state: NoteSessionState): ReactNode | undefined {
  if (state.status !== 'ready') return undefined;
  switch (state.saveState) {
    case 'saving':
      return strings.saving;
    case 'saved':
      return strings.saved;
    case 'retrying':
      return strings.retrying;
    case 'failed':
      // Refused or not, the bar says so: the reason's Callout may be scrolled out of view in a long note.
      return strings.notSaved;
    case 'idle':
      return state.isNew || state.updatedAt === undefined ? undefined : (
        <span aria-live="off">
          {`${strings.edited} `}
          <RelativeTime value={state.updatedAt} />
        </span>
      );
  }
}

/**
 * The note window (AC-439 to AC-443, AC-445): the Modal's peek from the
 * moment it opens, whatever state its note is in, with the record as the
 * bar's crumb and the note as a page under it, its title over its text with
 * no box around either. A new note stores nothing until it holds text, then
 * saves itself as it is typed; a note that doesn't exist, was deleted, or is
 * hidden says so. Closing with a save pending closes at once; the save
 * finishes in the data layer. Delete is one click: the window closes and
 * the toast offers Undo for 10 seconds (the owner's rule: Undo deletes never
 * ask first).
 */
export function NoteWindow(props: NoteWindowProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const { slug, note, record, members, canChange, onStored, onClose } = props;
  // A new note's id, minted once when the window opens on it.
  const [newId] = useState(() => data.notes.newId());
  const noteId = note === 'new' ? newId : note;
  const [opened, setOpened] = useState<NoteSession | 'failed' | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  // One delete, and one close: a second press (a double click) does nothing, and a window that closed (stepping Back)
  // never closes again, whatever a late click outside it says.
  const isRemoving = useRef(false);
  const hasClosed = useRef(false);
  const close = () => {
    if (hasClosed.current) return;
    hasClosed.current = true;
    onClose();
  };
  useEffect(() => {
    let isLive = true;
    data.notes
      .open(slug, { noteId, recordId: record.recordId, objectId: record.objectId, isNew: note === 'new', canChange })
      .then(
        (session) => {
          if (isLive) setOpened(session);
        },
        () => {
          if (isLive) setOpened('failed');
        },
      );
    return () => {
      isLive = false;
    };
    // `note` turning from `new` into this id finds the same session again.
  }, [data, slug, noteId, note, record.recordId, record.objectId, canChange, attempt]);
  const session = typeof opened === 'object' ? opened : LOADING_SESSION;
  const state = useNoteSession(session);

  // Once its first save stored a new note, the address names it.
  useEffect(() => {
    if (note === 'new' && state.status === 'ready' && !state.isNew && state.noteId === noteId) onStored(noteId);
  }, [note, state.status, state.isNew, state.noteId, noteId, onStored]);

  const nameOf = (actor: { readonly type: string; readonly id: string | null }) =>
    actor.type === 'member' ? actorDisplay(members, actor).name : strings.someone;
  const mentions = useMemo(
    () =>
      (query: string): Promise<readonly ActorDisplay[]> => {
        const wanted = query.trim().toLowerCase();
        return Promise.resolve(
          members
            .filter((member) => wanted === '' || member.name.toLowerCase().includes(wanted))
            .slice(0, 8)
            .map((member) => ({ type: 'member' as const, id: member.id, name: member.name, email: member.email })),
        );
      },
    [members],
  );
  // A mention draws the member's name now, from the members store, never the label the document stored.
  const mentionName = useMemo(() => {
    const names = new Map(members.map((member) => [member.id, member.name]));
    return (id: string) => names.get(id);
  }, [members]);

  const copyLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('note', noteId);
    navigator.clipboard.writeText(url.href).then(
      () => {
        toasts.toast({ tone: 'success', message: strings.linkCopied });
      },
      () => {
        toasts.toast({ tone: 'danger', message: strings.copyFailed });
      },
    );
  };
  // Delete note: the window closes at once and the toast offers Undo; a refusal takes the toast back and says why.
  const remove = () => {
    if (isRemoving.current) return;
    isRemoving.current = true;
    close();
    deleteWithUndo({
      toasts,
      remove: () => data.notes.remove(slug, record.recordId, noteId),
      restore: () => data.notes.restore(slug, record.recordId, noteId),
      words: {
        deleted: strings.noteDeleted,
        undo: strings.undo,
        notDeleted: (reason) => `${strings.notDeleted} ${reason}`,
        notRestored: (reason) => `${strings.notRestored} ${reason}`,
      },
      listLabel: strings.listLabel,
    });
  };

  const isReady = state.status === 'ready';
  const isUnavailable = state.isUnavailable;
  const isEditable = isReady && state.canChange && !state.isUnavailable;
  const title = !isReady
    ? strings.note
    : state.title.trim() !== ''
      ? state.title
      : state.isNew
        ? strings.newNote
        : strings.untitled;
  const status = statusOf(state);

  let body: ReactNode;
  if (opened === 'failed') {
    body = (
      <EmptyState
        tone="error"
        title={strings.loadFailed}
        onRetry={() => {
          setOpened(undefined);
          setAttempt((count) => count + 1);
        }}
      />
    );
  } else if (state.status === 'missing') {
    body = <EmptyState title={strings.unavailable} actions={<Button onPress={close}>{strings.close}</Button>} />;
  } else if (state.status === 'error') {
    body = (
      <EmptyState tone="error" title={strings.loadFailed} onRetry={session.retry}>
        {state.error?.message}
      </EmptyState>
    );
  } else if (state.status === 'loading') {
    body = <EmptyState title={strings.loading} isLoading />;
  } else {
    body = (
      <>
        {isUnavailable && (
          <Callout tone="danger" isAnnounced>
            {strings.unavailable}
          </Callout>
        )}
        {state.refusal !== undefined && !state.isUnavailable && (
          <Callout tone="danger" isAnnounced>
            {state.refusal.message}
          </Callout>
        )}
        {!state.canChange && <Callout tone="info">{strings.readOnly}</Callout>}
        {state.notice !== undefined && (
          <Callout
            tone={state.notice.kind === 'theirs' ? 'info' : 'warning'}
            isAnnounced
            actions={
              <Button variant="ghost" size="sm" onPress={session.dismissNotice}>
                {strings.dismiss}
              </Button>
            }
          >
            {state.notice.kind === 'theirs'
              ? strings.theirVersion(nameOf(state.notice.by))
              : strings.savedOverTheirs(nameOf(state.notice.by))}
          </Callout>
        )}
        <Suspense
          fallback={
            // The page's shape while the editor's chunk loads: a title line over the text's lines.
            <>
              <Skeleton width="medium" />
              <Skeleton lines={6} />
            </>
          }
        >
          <NoteEditor
            // Someone else's save replaced the body: the editor starts again from it, and the old one's last
            // text (handed over as it unmounts) is dropped by its key.
            key={state.docKey}
            label={strings.body}
            title={state.title}
            onTitleChange={session.setTitle}
            titleLabel={strings.title}
            titlePlaceholder={strings.titlePlaceholder}
            titleMaxLength={NOTE_TITLE_MAX}
            defaultValue={(state.doc ?? null) as RichTextDoc | null}
            onChange={(doc) => {
              session.setDoc(doc, state.docKey);
            }}
            onSearchMentions={mentions}
            mentionName={mentionName}
            isReadOnly={!isEditable}
            // Focus lands in the title of a new note and at the start of the text of one opened again (spec 0019,
            // keyboard and focus), once: never again when someone else's version replaces the page.
            {...(state.docKey === 0 ? { autoFocus: state.isNew ? ('title' as const) : ('text' as const) } : {})}
          />
        </Suspense>
      </>
    );
  }

  return (
    <Modal
      variant="peek"
      title={title}
      context={
        <RecordChip display={record} isFlat {...(props.recordHref === undefined ? {} : { href: props.recordHref })} />
      }
      isOpen
      onOpenChange={(open) => {
        if (!open) close();
      }}
      {...(status === undefined ? {} : { status })}
      headerActions={
        <>
          {isReady && state.saveState === 'failed' && state.refusal === undefined && (
            <Button variant="ghost" size="sm" onPress={session.retry}>
              {strings.retry}
            </Button>
          )}
          {isReady && !state.isNew && (
            <MenuTrigger>
              <Tooltip content={strings.more}>
                <Button variant="ghost" icon="ellipsis" label={strings.more} />
              </Tooltip>
              <Menu
                label={strings.more}
                onAction={(key) => {
                  if (key === 'copy') copyLink();
                  if (key === 'delete') remove();
                }}
              >
                <MenuItem id="copy" icon="link">
                  {strings.copyLink}
                </MenuItem>
                {state.canChange ? (
                  <MenuItem id="delete" icon="trash" isDanger>
                    {strings.deleteNote}
                  </MenuItem>
                ) : null}
              </Menu>
            </MenuTrigger>
          )}
        </>
      }
    >
      {body}
    </Modal>
  );
}
