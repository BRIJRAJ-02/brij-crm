// Brief
// Purpose: everything that needs the person in this workspace, on `/w/$slug/inbox`: mentions, replies, tasks given to them,
// and new submissions to the forms they're told about.
// Main task: open each new one where it lives (the comment's thread, the task), and clear the inbox as they go.
// Leaves out: email and digest settings (Settings › Account › Notifications), other people's notifications, search.
import type { InboxList, MemberSummary, NotificationView, ObjectSummary } from '@crm/data';
import { useInboxList, useInboxUnread } from '@crm/data/react';
import {
  Button,
  NotificationList,
  SectionBar,
  SegmentedControl,
  Select,
  Switch,
  Tooltip,
  TopBar,
  type IconName,
  type ListSource,
  type NotificationItem,
} from '@crm/ui';
import { useNavigate, useRouteContext, useRouter } from '@tanstack/react-router';
import { useMemo, useRef } from 'react';
import { TaskDialog } from '../tasks/TaskDialog.tsx';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { targetOf, toNotificationItem } from './entries.ts';
import { notificationKind, type InboxKind, type InboxSearch } from './search.ts';
import { strings } from './strings.ts';

/** How near the end of what is loaded the list asks for the next 50. */
const LOAD_AHEAD = 10;

/** Props for the inbox: what its route loaded through the data layer, and its address. */
export interface InboxScreenProps {
  readonly slug: string;
  readonly search: InboxSearch;
  /** The list the tab and filters name. */
  readonly list: InboxList;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
  readonly meId: string | undefined;
}

const TABS: readonly { readonly value: 'inbox' | 'done'; readonly label: string }[] = [
  { value: 'inbox', label: strings.inbox },
  { value: 'done', label: strings.done },
];

/** The kind filter's choices: a menu, so all and four kinds fit beside Inbox and Done on a phone (AC-1170). */
const KINDS: readonly { readonly value: 'all' | InboxKind; readonly label: string; readonly icon?: IconName }[] = [
  { value: 'all', label: strings.allKinds, icon: 'inbox' },
  { value: 'mentions', label: strings.mentions, icon: 'at-sign' },
  { value: 'replies', label: strings.replies, icon: 'message-square' },
  { value: 'assignments', label: strings.assignments, icon: 'user-check' },
  { value: 'submissions', label: strings.submissions, icon: 'clipboard-list' },
];

/** The list's notifications as NotificationList's rows, each mapped once while the members stay, loading more near the end. */
function useNotificationItems(
  items: readonly NotificationView[],
  members: readonly MemberSummary[],
  loadMore: (() => void) | undefined,
): ListSource<NotificationItem> {
  const cache = useMemo(() => ({ items: new WeakMap<NotificationView, NotificationItem>(), members }), [members]);
  return useMemo(
    () => ({
      count: items.length,
      getItem: (index: number) => {
        const view = items[index];
        if (view === undefined) return undefined;
        const held = cache.items.get(view);
        if (held !== undefined) return held;
        const made = toNotificationItem(view, cache.members);
        cache.items.set(view, made);
        return made;
      },
      getKey: (item: NotificationItem) => item.id,
      ...(loadMore === undefined
        ? {}
        : {
            onRangeChange: (range: { readonly end: number }) => {
              if (range.end >= items.length - LOAD_AHEAD) loadMore();
            },
          }),
    }),
    [items, cache, loadMore],
  );
}

/**
 * The inbox (spec 0038, AC-1169 to AC-1173): the person's notifications newest
 * first, Inbox or Done, filtered by kind and unread only (all kept in the
 * address); a row opens what it is about and marks it read, its menu and keys
 * mark it; Mark all as read clears the tab and kind shown.
 */
export function InboxScreen({ slug, search, list, objects, members, meId }: InboxScreenProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const router = useRouter();
  const state = useInboxList(list);
  const unread = useInboxUnread(data.inbox.unread(slug)) ?? 0;
  const status = search.status ?? 'inbox';
  const kind = notificationKind(search.kind);
  const loadMore = state.hasMore && !state.isLoadingMore ? list.loadMore : undefined;
  const items = useNotificationItems(state.items, members, loadMore);
  const objectSlugs = useMemo(() => new Map(objects.map((object) => [object.id, object.apiSlug])), [objects]);
  const displays = useMemo(
    () => members.map((member) => ({ type: 'member' as const, id: member.id, name: member.name })),
    [members],
  );
  // Whether this page opened the task dialog, so closing it steps Back rather than adding a step.
  const openedHere = useRef(false);

  const go = (next: InboxSearch, push = false) => {
    void navigate({ to: '/w/$slug/inbox', params: { slug }, search: next, ...(push ? {} : { replace: true }) });
  };
  const filtersOnly = (change: Partial<InboxSearch>): InboxSearch => {
    const merged = { ...search, ...change };
    return {
      ...(merged.status === undefined ? {} : { status: merged.status }),
      ...(merged.kind === undefined ? {} : { kind: merged.kind }),
      ...(merged.unread === undefined ? {} : { unread: merged.unread }),
    };
  };

  const open = (id: string) => {
    const view = state.items.find((each) => each.id === id);
    if (view === undefined) return;
    if (view.readAt === undefined) void data.inbox.mark(slug, [id], { read: true });
    const target = targetOf(slug, view, objectSlugs);
    if (target?.kind === 'task') {
      openedHere.current = true;
      go({ ...filtersOnly({}), task: target.taskId }, true);
    } else if (target?.kind === 'href') {
      void navigate({ href: target.href });
    }
  };
  const closeTask = () => {
    if (openedHere.current) {
      openedHere.current = false;
      router.history.back();
      return;
    }
    go(filtersOnly({}));
  };

  const isFiltered = kind !== undefined || search.unread === 1;
  const kindLabel = search.kind === undefined ? undefined : KINDS.find((each) => each.value === search.kind)?.label;
  // Mark all as read marks the tab and kind shown: on while something there is unread, as far as it has loaded.
  const hasUnread = unread > 0 && (state.hasMore || state.items.some((each) => each.readAt === undefined));
  const tabLabel = status === 'done' ? strings.done : strings.inbox;
  let emptyTitle: string | undefined;
  if (isFiltered) emptyTitle = strings.emptyFiltered;
  else if (status === 'done') emptyTitle = strings.emptyDone;

  return (
    <WorkspacePage
      currentPage="inbox"
      page={{
        topBar: (
          <TopBar title={strings.inbox} icon="inbox">
            {hasUnread ? (
              <Button
                icon="check"
                onPress={() => {
                  void data.inbox.markAllRead(slug, status, kind);
                }}
              >
                {strings.markAllRead}
              </Button>
            ) : (
              // Off with nothing unread here, and says so on hover and focus.
              <Tooltip content={strings.nothingUnread}>
                <Button icon="check" isDisabled>
                  {strings.markAllRead}
                </Button>
              </Tooltip>
            )}
          </TopBar>
        ),
        toolbar: (
          // A page bar rather than Toolbar: Toolbar's arrow keys would move focus off a segment instead of choosing.
          <SectionBar
            variant="bar"
            start={
              <>
                <SegmentedControl
                  label={strings.whichNotifications}
                  segments={TABS}
                  value={status}
                  onChange={(value) => {
                    go(filtersOnly({ status: value === 'done' ? 'done' : undefined }));
                  }}
                />
                <Select
                  label={strings.kindLabel}
                  isLabelHidden
                  size="sm"
                  items={KINDS.map(({ value, label, icon }) => ({
                    id: value,
                    label,
                    ...(icon === undefined ? {} : { icon }),
                  }))}
                  value={search.kind ?? 'all'}
                  onChange={(value) => {
                    const picked = KINDS.find((each) => each.value === value)?.value;
                    go(filtersOnly({ kind: picked === undefined || picked === 'all' ? undefined : picked }));
                  }}
                />
              </>
            }
            end={
              <Switch
                label={strings.unreadOnly}
                isSelected={search.unread === 1}
                onChange={(isSelected) => {
                  go(filtersOnly({ unread: isSelected ? 1 : undefined }));
                }}
              />
            }
          />
        ),
        body: (
          <>
            <NotificationList
              label={strings.listLabel(tabLabel, kindLabel)}
              items={items}
              members={displays}
              formerMember={strings.formerMember}
              status={state.status}
              onRetry={list.retry}
              onAction={open}
              onMark={(id, mark) => {
                void data.inbox.mark(slug, [id], mark);
              }}
              {...(emptyTitle === undefined ? {} : { emptyTitle })}
              {...(isFiltered || status === 'done' ? {} : { emptyBody: strings.emptyBody })}
              {...(isFiltered
                ? { emptyIcon: 'list-filter' as const }
                : status === 'done'
                  ? { emptyIcon: 'check' as const }
                  : {})}
              {...(isFiltered
                ? {
                    emptyActions: (
                      <Button
                        onPress={() => {
                          go(status === 'done' ? { status: 'done' } : {});
                        }}
                      >
                        {strings.clearFilters}
                      </Button>
                    ),
                  }
                : {})}
            />
            {search.task !== undefined && (
              <TaskDialog
                slug={slug}
                task={search.task}
                objects={objects}
                members={members}
                meId={meId}
                onClose={closeTask}
              />
            )}
          </>
        ),
      }}
    />
  );
}
