// Brief
// Purpose: one note, on `?note=<id>` (or `?note=new`) over the record page, saving itself as it is typed.
// Main task: write what was learned (a title and the body), and trust that it's saved.
// Leaves out: writing together in real time and versions (#27), comments on a passage (#29), moving a note.
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
  Field,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  RecordChip,
  Skeleton,
  Tooltip,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { actorDisplay } from './entries.ts';
import { strings } from './strings.ts';

/** The editor, in its own chunk: loaded when a note first opens, never with the app (AC-451). */
const NoteEditor = lazy(() => import('@crm/ui/editor').then((module) => ({ default: module.NoteEditor })));

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

/** The save state's words beside the title bar's actions. */
function saveWords(state: NoteSessionState): string | undefined {
  if (state.isNew) return undefined;
  switch (state.saveState) {
    case 'saving':
      return strings.saving;
    case 'saved':
      return strings.saved;
    case 'retrying':
      return strings.retrying;
    case 'failed':
      return state.refusal === undefined ? strings.notSaved : undefined;
    case 'idle':
      return undefined;
  }
}

/** The window's frame: the record's chip, the save state, the menu and Close in its title bar. */
function NoteModal({
  title,
  record,
  recordHref,
  headerActions,
  onClose,
  children,
}: {
  readonly title: string;
  readonly record: RecordRefDisplay;
  readonly recordHref?: string;
  readonly headerActions?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Modal
      variant="window"
      icon="notebook"
      title={title}
      context={<RecordChip display={record} isFlat {...(recordHref === undefined ? {} : { href: recordHref })} />}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      {...(headerActions === undefined ? {} : { headerActions })}
    >
      {children}
    </Modal>
  );
}

/** The open note: its notices, title and editor, saved through the session. */
function OpenNote({ session, props }: { readonly session: NoteSession; readonly props: NoteWindowProps }) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const state = useNoteSession(session);
  const { slug, record, recordHref, members, onStored, onClose } = props;
  // Once its first save stored a new note, the address names it.
  useEffect(() => {
    if (props.note === 'new' && !state.isNew) onStored(state.noteId);
  }, [props.note, state.isNew, state.noteId, onStored]);
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
  const copyLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('note', state.noteId);
    navigator.clipboard.writeText(url.href).then(
      () => {
        toasts.toast({ tone: 'success', message: strings.linkCopied });
      },
      () => {
        toasts.toast({ tone: 'danger', message: strings.copyFailed });
      },
    );
  };
  const remove = () => {
    const { noteId } = state;
    onClose();
    void data.notes.remove(slug, record.recordId, noteId).then((failure) => {
      if (failure !== undefined) {
        toasts.toast({ tone: 'danger', message: `${strings.notDeleted} ${failure.message}` });
        return;
      }
      // Undo for 10 seconds (AC-445): the toast goes by itself then.
      const key = toasts.toast({
        tone: 'success',
        message: strings.noteDeleted,
        action: {
          label: strings.undo,
          onAction: () => {
            void data.notes.restore(slug, record.recordId, noteId).then((refused) => {
              if (refused !== undefined) {
                toasts.toast({ tone: 'danger', message: `${strings.notRestored} ${refused.message}` });
              }
            });
          },
        },
      });
      setTimeout(() => {
        toasts.dismiss(key);
      }, 10_000);
    });
  };
  const words = saveWords(state);
  const isEditable = state.canChange && !state.isUnavailable;
  const title = state.title.trim() === '' ? (state.isNew ? strings.newNote : strings.untitled) : state.title;
  const headerActions = (
    <>
      {words !== undefined && (
        <span role="status" aria-live="polite">
          {words}
        </span>
      )}
      {state.saveState === 'failed' && state.refusal === undefined && (
        <Button variant="ghost" size="sm" onPress={session.retry}>
          {strings.retry}
        </Button>
      )}
      {!state.isNew && (
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
  );
  return (
    <NoteModal
      title={title}
      record={record}
      {...(recordHref === undefined ? {} : { recordHref })}
      headerActions={headerActions}
      onClose={onClose}
    >
      {state.isUnavailable && (
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
      <Field
        label={strings.title}
        isLabelHidden
        placeholder={strings.titlePlaceholder}
        value={state.title}
        onChange={session.setTitle}
        maxLength={NOTE_TITLE_MAX}
        isReadOnly={!isEditable}
      />
      <Suspense fallback={<Skeleton lines={6} />}>
        <NoteEditor
          // Someone else's save replaced the body: the editor starts again from it.
          key={state.docKey}
          label={strings.body}
          placeholder={strings.bodyPlaceholder}
          defaultValue={(state.doc ?? null) as RichTextDoc | null}
          onChange={session.setDoc}
          onSearchMentions={mentions}
          isReadOnly={!isEditable}
        />
      </Suspense>
    </NoteModal>
  );
}

/**
 * The note window (AC-439 to AC-443, AC-445): a new note stores nothing
 * until it holds text, then saves itself as it is typed; an existing one
 * opens from the session; a note that doesn't exist, was deleted, or is
 * hidden says so. Closing with a save pending closes at once; the save
 * finishes in the data layer.
 */
export function NoteWindow(props: NoteWindowProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const { slug, note, record, canChange } = props;
  // A new note's id, minted once when the window opens on it.
  const [newId] = useState(() => data.notes.newId());
  const noteId = note === 'new' ? newId : note;
  const [session, setSession] = useState<NoteSession | 'failed' | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let isLive = true;
    data.notes.open(slug, { noteId, recordId: record.recordId, isNew: note === 'new', canChange }).then(
      (opened) => {
        if (isLive) setSession(opened);
      },
      () => {
        if (isLive) setSession('failed');
      },
    );
    return () => {
      isLive = false;
    };
    // `note` turning from `new` into this id finds the same session again.
  }, [data, slug, noteId, note, record.recordId, canChange, attempt]);
  if (session === undefined || session === 'failed') {
    return (
      <NoteModal title={strings.note} record={record} onClose={props.onClose}>
        {session === 'failed' ? (
          <EmptyState
            tone="error"
            title={strings.loadFailed}
            onRetry={() => {
              setSession(undefined);
              setAttempt((count) => count + 1);
            }}
          />
        ) : (
          <EmptyState title={strings.loading} isLoading />
        )}
      </NoteModal>
    );
  }
  return <SessionGate session={session} props={props} />;
}

/** The session's own states before the note opens: loading, missing or failed. */
function SessionGate({ session, props }: { readonly session: NoteSession; readonly props: NoteWindowProps }) {
  const state = useNoteSession(session);
  if (state.status === 'ready') return <OpenNote session={session} props={props} />;
  return (
    <NoteModal title={strings.note} record={props.record} onClose={props.onClose}>
      {state.status === 'missing' ? (
        <EmptyState title={strings.unavailable} actions={<Button onPress={props.onClose}>{strings.close}</Button>} />
      ) : state.status === 'error' ? (
        <EmptyState tone="error" title={strings.loadFailed} onRetry={session.retry}>
          {state.error?.message}
        </EmptyState>
      ) : (
        <EmptyState title={strings.loading} isLoading />
      )}
    </NoteModal>
  );
}
