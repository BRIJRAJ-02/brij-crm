// Brief
// Purpose: the team's conversation about this record, on its page's Comments tab.
// Main task: start a thread or reply in one, mentioning a member with @, and resolve it when it's settled.
// Leaves out: mentions in notes (round 4), attachments, comments on a single field.
import type { MemberSummary, RecordComments, ShownThread } from '@crm/data';
import { useComments } from '@crm/data/react';
import {
  Button,
  Callout,
  CommentComposer,
  CommentThread,
  Disclosure,
  EmptyState,
  Modal,
  Skeleton,
  VisuallyHidden,
  type CommentThreadItem,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { memberDisplays, toThreadItem } from './entries.ts';
import { strings } from './strings.ts';

/** How long a thread opened from a link stays lit (AC-1161). */
const HIGHLIGHT_MS = 2000;

/** Props for a record's Comments tab. */
export interface CommentsTabProps {
  readonly slug: string;
  readonly recordId: string;
  readonly comments: RecordComments;
  readonly members: readonly MemberSummary[];
  /** The person's member id: their comments and reactions. Without it nothing can be written. */
  readonly meId: string | undefined;
  /** The record is in the trash (or lost): threads show, with no composers, menus or reaction buttons. */
  readonly isReadOnly: boolean;
  /** `?thread=`: the thread a link names, unfolded, scrolled to and lit for a moment. */
  readonly thread?: string;
}

/** Threads as CommentThread's items, each mapped once per thread while the members stay. */
function useThreadItems(members: readonly MemberSummary[]) {
  const cache = useMemo(() => ({ items: new WeakMap<ShownThread, CommentThreadItem>(), members }), [members]);
  return (thread: ShownThread): CommentThreadItem => {
    const held = cache.items.get(thread);
    if (held !== undefined) return held;
    const made = toThreadItem(thread, cache.members);
    cache.items.set(thread, made);
    return made;
  };
}

/** Three threads' worth of skeleton rows while the first page loads (AC-1162); the record page's pending tab too. */
export function LoadingThreads() {
  return (
    <>
      <VisuallyHidden>{strings.loadingThreads}</VisuallyHidden>
      <Skeleton lines={2} />
      <Skeleton lines={3} />
      <Skeleton lines={2} />
    </>
  );
}

/**
 * A record's Comments tab (spec 0038, AC-1151 to AC-1162): open threads oldest
 * first with "Show earlier threads" above them, the composer for a new thread,
 * then "Resolved threads (n)" folded. Every write goes through the data layer
 * at once; a delete asks first.
 */
export function CommentsTab({ slug, recordId, comments, members, meId, isReadOnly, thread }: CommentsTabProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const state = useComments(comments);
  const item = useThreadItems(members);
  const displays = useMemo(() => memberDisplays(members), [members]);
  const [deleting, setDeleting] = useState<string | undefined>(undefined);
  const [isResolvedOpen, setIsResolvedOpen] = useState(false);
  const [lit, setLit] = useState<string | undefined>(undefined);
  const [isMissing, setIsMissing] = useState(false);
  const canWrite = !isReadOnly && meId !== undefined;

  // A link to a thread (AC-1161): load until the thread is held, unfold the resolved ones when it is there, and
  // light it for two seconds. A thread that is gone or hidden says so in the tab.
  useEffect(() => {
    if (thread === undefined) return;
    let isCurrent = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void comments.reveal(thread).then((where) => {
      if (!isCurrent) return;
      if (where === 'missing') {
        setIsMissing(true);
        return;
      }
      setIsMissing(false);
      if (where === 'resolved') setIsResolvedOpen(true);
      setLit(thread);
      timer = setTimeout(() => {
        setLit(undefined);
      }, HIGHLIGHT_MS);
    });
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [comments, thread]);

  const reason = (error: { readonly message: string } | undefined) => error?.message;
  const threadProps = (shown: ShownThread) => ({
    thread: item(shown),
    members: displays,
    formerMember: strings.formerMember,
    isReadOnly: !canWrite,
    isHighlighted: lit === shown.id,
    onReply: async (body: string) =>
      reason(await data.comments.create(slug, recordId, { body, threadId: shown.id, authorId: meId ?? '' })),
    onEdit: async (commentId: string, body: string) =>
      reason(await data.comments.edit(slug, recordId, commentId, body)),
    onDelete: setDeleting,
    onResolve: (resolved: boolean) => {
      void data.comments.resolve(slug, recordId, shown.id, resolved);
    },
    onReact: (commentId: string, emoji: Parameters<typeof data.comments.react>[3], on: boolean) => {
      if (meId !== undefined) void data.comments.react(slug, recordId, commentId, emoji, on, meId);
    },
    onLoadVersions: async (commentId: string) =>
      data.comments.versions(slug, commentId).then(
        (versions) => versions,
        () => undefined,
      ),
    ...(shown.earlierCount > 0
      ? {
          onShowEarlier: () => {
            void comments.loadWholeThread(shown.id);
          },
        }
      : {}),
  });

  if (state.status === 'unavailable') {
    return <EmptyState icon="message-square" title={strings.unavailable} />;
  }
  if (state.status === 'error') {
    return (
      <EmptyState tone="error" title={strings.loadFailed} onRetry={comments.retry}>
        {state.error?.message ?? strings.loadFailedText}
      </EmptyState>
    );
  }
  if (state.status === 'loading') return <LoadingThreads />;

  const composer = canWrite ? (
    <CommentComposer
      members={displays}
      formerMember={strings.formerMember}
      onSubmit={async (body) => reason(await data.comments.create(slug, recordId, { body, authorId: meId }))}
    />
  ) : undefined;
  const isEmpty = state.open.length === 0 && state.resolvedCount === 0;

  return (
    <>
      {isMissing && (
        <Callout
          tone="warning"
          actions={
            <Button
              variant="ghost"
              onPress={() => {
                setIsMissing(false);
              }}
            >
              {strings.dismiss}
            </Button>
          }
        >
          {strings.threadUnavailable}
        </Callout>
      )}
      {state.hasEarlier && (
        <Button variant="ghost" isPending={state.isLoadingEarlier} onPress={comments.loadEarlier}>
          {strings.earlierThreads}
        </Button>
      )}
      {isEmpty && <EmptyState icon="message-square" title={canWrite ? strings.noComments : strings.noCommentsShort} />}
      {state.open.map((shown) => (
        <CommentThread key={shown.id} {...threadProps(shown)} />
      ))}
      {composer}
      {state.resolvedCount > 0 && (
        <Disclosure
          title={strings.resolvedThreads}
          count={state.resolvedCount}
          variant="fields"
          isExpanded={isResolvedOpen}
          onExpandedChange={(isExpanded) => {
            setIsResolvedOpen(isExpanded);
            if (isExpanded && state.resolvedStatus === 'idle') comments.loadResolved();
          }}
        >
          {state.resolvedStatus === 'error' ? (
            <EmptyState tone="error" title={strings.resolvedFailed} onRetry={comments.loadResolved} />
          ) : state.resolved === undefined ? (
            <LoadingThreads />
          ) : (
            <>
              {state.resolved.map((shown) => (
                <CommentThread key={shown.id} {...threadProps(shown)} />
              ))}
              {state.hasEarlierResolved && (
                <Button variant="ghost" isPending={state.resolvedStatus === 'loading'} onPress={comments.loadResolved}>
                  {strings.moreResolved}
                </Button>
              )}
            </>
          )}
        </Disclosure>
      )}
      <Modal
        title={strings.deleteTitle}
        tone="danger"
        isOpen={deleting !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDeleting(undefined);
        }}
        actions={
          <>
            <Button slot="close">{strings.keep}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                if (deleting !== undefined) void data.comments.remove(slug, recordId, deleting);
                setDeleting(undefined);
              }}
            >
              {strings.delete}
            </Button>
          </>
        }
      >
        {strings.deleteText}
      </Modal>
    </>
  );
}
